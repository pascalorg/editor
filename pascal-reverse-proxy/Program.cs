using System.Net;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<PascalDatabaseOptions>(builder.Configuration.GetSection("PascalDatabase"));
builder.Services.Configure<ProxyDatabaseOptions>(builder.Configuration.GetSection("ProxyDatabase"));
builder.Services.Configure<ProxyAuthOptions>(builder.Configuration.GetSection("ProxyAuth"));
builder.Services.AddReverseProxy().LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"));

var app = builder.Build();
var frontRoot = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "pascal-reverse-front"));
var frontIndex = Path.Combine(frontRoot, "index.html");
var frontLogo = Path.Combine(frontRoot, "logo.svg");
var proxyDatabaseOptions = app.Services.GetRequiredService<IOptions<ProxyDatabaseOptions>>().Value;
var proxyDatabasePath = ResolveProxyDatabasePath(app.Environment.ContentRootPath, proxyDatabaseOptions);
var coverRoot = Path.Combine(Path.GetDirectoryName(proxyDatabasePath) ?? app.Environment.ContentRootPath, "covers");
InitializeProxyDatabase(proxyDatabasePath);

app.UseWebSockets();

app.MapGet("/proxy/health", (IOptions<ProxyAuthOptions> authOptions, IConfiguration configuration) =>
{
    var destination = configuration["ReverseProxy:Clusters:pascal:Destinations:editor:Address"];
    return Results.Ok(new
    {
        status = "ok",
        proxy = "pascal-reverse-proxy",
        authEnabled = authOptions.Value.Enabled,
        destination,
        timestamp = DateTimeOffset.UtcNow,
    });
});

app.MapGet("/proxy/scenes", async (IOptions<PascalDatabaseOptions> databaseOptions, CancellationToken cancellationToken) =>
{
    var databasePath = ResolvePascalDatabasePath(databaseOptions.Value, Environment.GetEnvironmentVariables());
    if (!File.Exists(databasePath))
    {
        return Results.NotFound(new
        {
            error = "pascal_database_not_found",
            path = databasePath,
        });
    }

    var scenes = new List<SceneListItem>();
    var connectionString = new SqliteConnectionStringBuilder
    {
        DataSource = databasePath,
        Mode = SqliteOpenMode.ReadOnly,
        Cache = SqliteCacheMode.Shared,
    }.ToString();

    await using var connection = new SqliteConnection(connectionString);
    await connection.OpenAsync(cancellationToken);

    await using var command = connection.CreateCommand();
    command.CommandText = """
        SELECT id,
               name,
               project_id,
               owner_id,
               thumbnail_url,
               version,
               created_at,
               updated_at,
               size_bytes,
               node_count
          FROM scenes
         ORDER BY updated_at DESC, id ASC
         LIMIT $limit
        """;
    command.Parameters.AddWithValue("$limit", Math.Clamp(databaseOptions.Value.ListLimit, 1, 500));

    await using var reader = await command.ExecuteReaderAsync(cancellationToken);
    while (await reader.ReadAsync(cancellationToken))
    {
        var sceneId = reader.GetString(0);
        var overrideData = FindProjectOverride(proxyDatabasePath, sceneId);
        var coverUrl = overrideData?.CoverType == "gradient" ? overrideData.CoverValue : FindSceneCoverUrl(proxyDatabasePath, sceneId);

        scenes.Add(new SceneListItem(
            sceneId,
            overrideData?.Name ?? reader.GetString(1),
            ReadNullableString(reader, 2),
            ReadNullableString(reader, 3),
            coverUrl ?? ReadNullableString(reader, 4),
            reader.GetInt32(5),
            reader.GetString(6),
            reader.GetString(7),
            reader.GetInt64(8),
            reader.GetInt32(9),
            overrideData?.Description,
            overrideData?.CoverType,
            overrideData?.CoverValue,
            $"/_pascal/scene/{Uri.EscapeDataString(sceneId)}"));
    }

    return Results.Ok(new
    {
        scenes,
        databasePath,
    });
});

app.MapPost("/proxy/scenes/{id}/cover", async (
    string id,
    HttpContext context,
    IOptions<ProxyDatabaseOptions> proxyOptions,
    CancellationToken cancellationToken) =>
{
    if (!IsSafeSceneId(id))
    {
        return Results.BadRequest(new { error = "invalid_scene_id" });
    }

    if (!context.Request.HasFormContentType)
    {
        return Results.BadRequest(new { error = "expected_multipart_form" });
    }

    var form = await context.Request.ReadFormAsync(cancellationToken);
    var file = form.Files.GetFile("file");
    if (file is null || file.Length == 0)
    {
        return Results.BadRequest(new { error = "missing_file" });
    }

    if (file.Length > 5 * 1024 * 1024)
    {
        return Results.BadRequest(new { error = "file_too_large", maxBytes = 5 * 1024 * 1024 });
    }

    var extension = ContentTypeToExtension(file.ContentType);
    if (extension is null)
    {
        return Results.BadRequest(new { error = "unsupported_image_type" });
    }

    var dbPath = ResolveProxyDatabasePath(app.Environment.ContentRootPath, proxyOptions.Value);
    InitializeProxyDatabase(dbPath);
    var localCoverRoot = Path.Combine(Path.GetDirectoryName(dbPath) ?? app.Environment.ContentRootPath, "covers");
    Directory.CreateDirectory(localCoverRoot);
    DeleteExistingSceneCovers(localCoverRoot, id);

    var fileName = $"{id}{extension}";
    var path = Path.Combine(localCoverRoot, fileName);
    await using (var stream = File.Create(path))
    {
        await file.CopyToAsync(stream, cancellationToken);
    }
    var relativePath = Path.Combine("covers", fileName).Replace('\\', '/');
    var coverUrl = BuildSceneCoverUrl(fileName, File.GetLastWriteTimeUtc(path));
    await UpsertProjectCover(dbPath, id, coverUrl, relativePath, file.ContentType, file.Length, cancellationToken);

    return Results.Ok(new
    {
        coverUrl,
    });
});

app.MapPut("/proxy/scenes/{id}/metadata", async (
    string id,
    ProjectMetadataRequest request,
    IOptions<ProxyDatabaseOptions> proxyOptions,
    CancellationToken cancellationToken) =>
{
    if (!IsSafeSceneId(id))
    {
        return Results.BadRequest(new { error = "invalid_scene_id" });
    }

    var dbPath = ResolveProxyDatabasePath(app.Environment.ContentRootPath, proxyOptions.Value);
    InitializeProxyDatabase(dbPath);

    await UpsertProjectOverride(
        dbPath,
        id,
        request.Name,
        request.Description,
        request.CoverType,
        request.CoverValue,
        cancellationToken);

    return Results.Ok(new { status = "ok" });
});

app.MapGet("/proxy/login", (HttpContext context, IOptions<ProxyAuthOptions> authOptions) =>
{
    var options = authOptions.Value;
    if (!options.Enabled)
    {
        return Results.Ok(new { status = "auth_disabled" });
    }

    if (string.IsNullOrWhiteSpace(options.ApiKey))
    {
        return Results.Problem("ProxyAuth:ApiKey must be configured when auth is enabled.", statusCode: 500);
    }

    var key = context.Request.Query["key"].ToString();
    if (!ConstantTimeEquals(key, options.ApiKey))
    {
        return Results.Unauthorized();
    }

    context.Response.Cookies.Append(
        options.CookieName,
        options.ApiKey,
        new CookieOptions
        {
            HttpOnly = true,
            IsEssential = true,
            SameSite = SameSiteMode.Lax,
            Secure = context.Request.IsHttps,
            Expires = DateTimeOffset.UtcNow.AddDays(7),
        });

    return Results.Redirect("/");
});

app.MapPost("/proxy/logout", (HttpContext context, IOptions<ProxyAuthOptions> authOptions) =>
{
    context.Response.Cookies.Delete(authOptions.Value.CookieName);
    return Results.Ok(new { status = "logged_out" });
});

app.Use(async (context, next) =>
{
    var options = context.RequestServices.GetRequiredService<IOptions<ProxyAuthOptions>>().Value;
    if (!options.Enabled || !IsProtectedPath(context.Request.Path, options.ProtectedPathPrefixes))
    {
        await next();
        return;
    }

    if (string.IsNullOrWhiteSpace(options.ApiKey))
    {
        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await context.Response.WriteAsJsonAsync(new
        {
            error = "proxy_auth_misconfigured",
            message = "ProxyAuth:ApiKey must be configured when auth is enabled.",
        });
        return;
    }

    var token = ReadToken(context, options);
    if (ConstantTimeEquals(token, options.ApiKey))
    {
        await next();
        return;
    }

    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
    await context.Response.WriteAsJsonAsync(new { error = "unauthorized" });
});

app.MapGet("/", () => Results.File(frontIndex, "text/html; charset=utf-8"));
app.MapGet("/scenes", () => Results.File(frontIndex, "text/html; charset=utf-8"));
app.MapGet("/logo.svg", () => Results.File(frontLogo, "image/svg+xml"));
app.MapGet("/proxy/covers/{fileName}", (string fileName, IOptions<ProxyDatabaseOptions> proxyOptions) =>
{
    if (Path.GetFileName(fileName) != fileName)
    {
        return Results.BadRequest();
    }

    var dbPath = ResolveProxyDatabasePath(app.Environment.ContentRootPath, proxyOptions.Value);
    var localCoverRoot = Path.Combine(Path.GetDirectoryName(dbPath) ?? app.Environment.ContentRootPath, "covers");
    var path = Path.Combine(localCoverRoot, fileName);
    if (!File.Exists(path))
    {
        return Results.NotFound();
    }

    return Results.File(path, GetCoverContentType(Path.GetExtension(path)));
});

app.MapGet("/api/pascal-function-static/{**relativePath}", (string relativePath) =>
{
    var pathParts = relativePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
    if (pathParts.Length < 2 || !IsSafeSceneId(pathParts[0]))
    {
        return Results.NotFound();
    }

    if (pathParts.Any(part => part is "." or ".." || Path.GetFileName(part) != part))
    {
        return Results.NotFound();
    }

    var staticRoot = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "pascal-function-statuc"));
    var filePath = Path.GetFullPath(Path.Combine(new[] { staticRoot }.Concat(pathParts).ToArray()));
    if (!filePath.StartsWith(staticRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
        !File.Exists(filePath))
    {
        return Results.NotFound();
    }

    return Results.File(filePath, GetStaticContentType(Path.GetExtension(filePath)), enableRangeProcessing: true);
});

if (Directory.Exists(frontRoot))
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(frontRoot),
        RequestPath = "",
    });
}

app.MapReverseProxy();

app.Run();

static string? ReadNullableString(SqliteDataReader reader, int ordinal)
{
    return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
}

static string? FindSceneCoverUrl(string databasePath, string sceneId)
{
    if (!File.Exists(databasePath)) return null;
    using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
    {
        DataSource = databasePath,
        Mode = SqliteOpenMode.ReadOnly,
        Cache = SqliteCacheMode.Shared,
    }.ToString());
    connection.Open();

    using var command = connection.CreateCommand();
    command.CommandText = """
        SELECT cover_url
          FROM project_covers
         WHERE scene_id = $sceneId
         LIMIT 1
        """;
    command.Parameters.AddWithValue("$sceneId", sceneId);
    return command.ExecuteScalar() as string;
}

static string BuildSceneCoverUrl(string fileName, DateTime updatedAt)
{
    return $"/proxy/covers/{Uri.EscapeDataString(fileName)}?v={updatedAt.Ticks}";
}

static void DeleteExistingSceneCovers(string coverRoot, string sceneId)
{
    foreach (var extension in new[] { ".jpg", ".jpeg", ".png", ".webp", ".gif" })
    {
        var path = Path.Combine(coverRoot, $"{sceneId}{extension}");
        if (File.Exists(path)) File.Delete(path);
    }
}

static string? ContentTypeToExtension(string contentType)
{
    return contentType.ToLowerInvariant() switch
    {
        "image/jpeg" => ".jpg",
        "image/png" => ".png",
        "image/webp" => ".webp",
        "image/gif" => ".gif",
        _ => null,
    };
}

static string GetCoverContentType(string extension)
{
    return extension.ToLowerInvariant() switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        _ => "application/octet-stream",
    };
}

static string GetStaticContentType(string extension)
{
    return extension.ToLowerInvariant() switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        ".mp4" => "video/mp4",
        ".webm" => "video/webm",
        ".mov" => "video/quicktime",
        ".json" => "application/json",
        ".txt" => "text/plain; charset=utf-8",
        ".vtt" => "text/vtt; charset=utf-8",
        _ => "application/octet-stream",
    };
}

static bool IsSafeSceneId(string id)
{
    if (id.Length is < 1 or > 128) return false;
    return id.All(ch => char.IsAsciiLetterOrDigit(ch) || ch is '-' or '_');
}

static string ResolveProxyDatabasePath(string contentRootPath, ProxyDatabaseOptions options)
{
    if (!string.IsNullOrWhiteSpace(options.Path))
    {
        return Path.GetFullPath(options.Path);
    }

    var proxyDbPath = Environment.GetEnvironmentVariable("PASCAL_PROXY_DB_PATH");
    if (!string.IsNullOrWhiteSpace(proxyDbPath))
    {
        return Path.GetFullPath(proxyDbPath);
    }

    proxyDbPath = Environment.GetEnvironmentVariable("PROXY_DB_PATH");
    if (!string.IsNullOrWhiteSpace(proxyDbPath))
    {
        return Path.GetFullPath(proxyDbPath);
    }

    var dotenv = ReadRepositoryDotEnv();
    if (dotenv.TryGetValue("PASCAL_PROXY_DB_PATH", out var dotenvProxyDbPath) &&
        !string.IsNullOrWhiteSpace(dotenvProxyDbPath))
    {
        return Path.GetFullPath(dotenvProxyDbPath);
    }

    if (dotenv.TryGetValue("PROXY_DB_PATH", out var dotenvDbPath) &&
        !string.IsNullOrWhiteSpace(dotenvDbPath))
    {
        return Path.GetFullPath(dotenvDbPath);
    }

    return Path.Combine(contentRootPath, "data", "proxy.db");
}

static void InitializeProxyDatabase(string databasePath)
{
    Directory.CreateDirectory(Path.GetDirectoryName(databasePath) ?? ".");
    using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
    {
        DataSource = databasePath,
        Cache = SqliteCacheMode.Shared,
    }.ToString());
    connection.Open();

    using var command = connection.CreateCommand();
    command.CommandText = """
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS project_covers (
          scene_id TEXT PRIMARY KEY,
          cover_url TEXT NOT NULL,
          file_path TEXT NOT NULL,
          content_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_overrides (
          scene_id TEXT PRIMARY KEY,
          name TEXT,
          description TEXT,
          cover_type TEXT,
          cover_value TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        """;
    command.ExecuteNonQuery();
}

static ProjectOverride? FindProjectOverride(string databasePath, string sceneId)
{
    if (!File.Exists(databasePath)) return null;
    using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
    {
        DataSource = databasePath,
        Mode = SqliteOpenMode.ReadOnly,
        Cache = SqliteCacheMode.Shared,
    }.ToString());
    connection.Open();

    using var command = connection.CreateCommand();
    command.CommandText = """
        SELECT name, description, cover_type, cover_value
          FROM project_overrides
         WHERE scene_id = $sceneId
         LIMIT 1
        """;
    command.Parameters.AddWithValue("$sceneId", sceneId);
    using var reader = command.ExecuteReader();
    if (!reader.Read()) return null;
    return new ProjectOverride(
        ReadNullableString(reader, 0),
        ReadNullableString(reader, 1),
        ReadNullableString(reader, 2),
        ReadNullableString(reader, 3));
}

static async Task UpsertProjectCover(
    string databasePath,
    string sceneId,
    string coverUrl,
    string filePath,
    string contentType,
    long sizeBytes,
    CancellationToken cancellationToken)
{
    await using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
    {
        DataSource = databasePath,
        Cache = SqliteCacheMode.Shared,
    }.ToString());
    await connection.OpenAsync(cancellationToken);

    var now = DateTimeOffset.UtcNow.ToString("O");
    await using var command = connection.CreateCommand();
    command.CommandText = """
        INSERT INTO project_covers (
          scene_id, cover_url, file_path, content_type, size_bytes, created_at, updated_at
        ) VALUES (
          $sceneId, $coverUrl, $filePath, $contentType, $sizeBytes, $now, $now
        )
        ON CONFLICT(scene_id) DO UPDATE SET
          cover_url = excluded.cover_url,
          file_path = excluded.file_path,
          content_type = excluded.content_type,
          size_bytes = excluded.size_bytes,
          updated_at = excluded.updated_at
        """;
    command.Parameters.AddWithValue("$sceneId", sceneId);
    command.Parameters.AddWithValue("$coverUrl", coverUrl);
    command.Parameters.AddWithValue("$filePath", filePath);
    command.Parameters.AddWithValue("$contentType", contentType);
    command.Parameters.AddWithValue("$sizeBytes", sizeBytes);
    command.Parameters.AddWithValue("$now", now);
    await command.ExecuteNonQueryAsync(cancellationToken);
}

static async Task UpsertProjectOverride(
    string databasePath,
    string sceneId,
    string? name,
    string? description,
    string? coverType,
    string? coverValue,
    CancellationToken cancellationToken)
{
    await using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
    {
        DataSource = databasePath,
        Cache = SqliteCacheMode.Shared,
    }.ToString());
    await connection.OpenAsync(cancellationToken);

    var now = DateTimeOffset.UtcNow.ToString("O");
    await using var command = connection.CreateCommand();
    command.CommandText = """
        INSERT INTO project_overrides (
          scene_id, name, description, cover_type, cover_value, created_at, updated_at
        ) VALUES (
          $sceneId, $name, $description, $coverType, $coverValue, $now, $now
        )
        ON CONFLICT(scene_id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          cover_type = excluded.cover_type,
          cover_value = excluded.cover_value,
          updated_at = excluded.updated_at
        """;
    command.Parameters.AddWithValue("$sceneId", sceneId);
    command.Parameters.AddWithValue("$name", string.IsNullOrWhiteSpace(name) ? DBNull.Value : name);
    command.Parameters.AddWithValue("$description", string.IsNullOrWhiteSpace(description) ? DBNull.Value : description);
    command.Parameters.AddWithValue("$coverType", string.IsNullOrWhiteSpace(coverType) ? DBNull.Value : coverType);
    command.Parameters.AddWithValue("$coverValue", string.IsNullOrWhiteSpace(coverValue) ? DBNull.Value : coverValue);
    command.Parameters.AddWithValue("$now", now);
    await command.ExecuteNonQueryAsync(cancellationToken);
}

static string ResolvePascalDatabasePath(
    PascalDatabaseOptions options,
    System.Collections.IDictionary environment)
{
    if (!string.IsNullOrWhiteSpace(options.Path))
    {
        return Path.GetFullPath(options.Path);
    }

    var pascalDbPath = environment["PASCAL_DB_PATH"]?.ToString();
    if (!string.IsNullOrWhiteSpace(pascalDbPath))
    {
        return Path.GetFullPath(pascalDbPath);
    }

    var pascalDataDir = environment["PASCAL_DATA_DIR"]?.ToString();
    if (!string.IsNullOrWhiteSpace(pascalDataDir))
    {
        return Path.GetFullPath(Path.Combine(pascalDataDir, "pascal.db"));
    }

    var dotenv = ReadRepositoryDotEnv();
    if (dotenv.TryGetValue("PASCAL_DB_PATH", out var dotenvDbPath) &&
        !string.IsNullOrWhiteSpace(dotenvDbPath))
    {
        return Path.GetFullPath(dotenvDbPath);
    }

    if (dotenv.TryGetValue("PASCAL_DATA_DIR", out var dotenvDataDir) &&
        !string.IsNullOrWhiteSpace(dotenvDataDir))
    {
        return Path.GetFullPath(Path.Combine(dotenvDataDir, "pascal.db"));
    }

    if (OperatingSystem.IsWindows())
    {
        var appData = environment["APPDATA"]?.ToString();
        if (!string.IsNullOrWhiteSpace(appData))
        {
            return Path.Combine(appData, "Pascal", "data", "pascal.db");
        }
    }

    var xdgDataHome = environment["XDG_DATA_HOME"]?.ToString();
    if (!string.IsNullOrWhiteSpace(xdgDataHome))
    {
        return Path.Combine(xdgDataHome, "pascal", "data", "pascal.db");
    }

    return Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".pascal",
        "data",
        "pascal.db");
}

static Dictionary<string, string> ReadRepositoryDotEnv()
{
    var candidates = new[]
    {
        Path.Combine(AppContext.BaseDirectory, ".env.local"),
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".env.local"),
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".env.local"),
        Path.Combine(Directory.GetCurrentDirectory(), ".env.local"),
        Path.Combine(Directory.GetCurrentDirectory(), "..", ".env.local"),
    };

    var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    var path = candidates.Select(Path.GetFullPath).FirstOrDefault(File.Exists);
    if (path is null) return result;

    foreach (var rawLine in File.ReadAllLines(path))
    {
        var line = rawLine.Trim();
        if (line.Length == 0 || line.StartsWith('#')) continue;

        var separator = line.IndexOf('=');
        if (separator <= 0) continue;

        var key = line[..separator].Trim();
        var value = line[(separator + 1)..].Trim().Trim('"').Trim('\'');
        if (key.Length > 0) result[key] = value;
    }

    return result;
}

static string? ReadToken(HttpContext context, ProxyAuthOptions options)
{
    if (context.Request.Cookies.TryGetValue(options.CookieName, out var cookieToken))
    {
        return cookieToken;
    }

    if (context.Request.Headers.TryGetValue(options.HeaderName, out var headerToken))
    {
        return headerToken.ToString();
    }

    var authorization = context.Request.Headers.Authorization.ToString();
    const string bearerPrefix = "Bearer ";
    if (authorization.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase))
    {
        return authorization[bearerPrefix.Length..].Trim();
    }

    return null;
}

static bool IsProtectedPath(PathString path, string[] prefixes)
{
    if (prefixes.Length == 0) return false;

    foreach (var prefix in prefixes)
    {
        if (string.IsNullOrWhiteSpace(prefix)) continue;
        if (path.StartsWithSegments(prefix, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
    }

    return false;
}

static bool ConstantTimeEquals(string? left, string? right)
{
    if (left is null || right is null) return false;

    var leftBytes = System.Text.Encoding.UTF8.GetBytes(left);
    var rightBytes = System.Text.Encoding.UTF8.GetBytes(right);
    return leftBytes.Length == rightBytes.Length &&
           System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(leftBytes, rightBytes);
}

sealed class ProxyAuthOptions
{
    public bool Enabled { get; init; }
    public string ApiKey { get; init; } = "";
    public string HeaderName { get; init; } = "X-Pascal-Proxy-Key";
    public string CookieName { get; init; } = "PascalProxyAuth";
    public string[] ProtectedPathPrefixes { get; init; } =
    [
        "/api/scenes",
        "/_pascal/scene",
        "/scenes",
        "/proxy/scenes",
    ];
}

sealed class PascalDatabaseOptions
{
    public string Path { get; init; } = "";
    public int ListLimit { get; init; } = 100;
}

sealed class ProxyDatabaseOptions
{
    public string Path { get; init; } = "";
}

sealed record SceneListItem(
    string Id,
    string Name,
    string? ProjectId,
    string? OwnerId,
    string? ThumbnailUrl,
    int Version,
    string CreatedAt,
    string UpdatedAt,
    long SizeBytes,
    int NodeCount,
    string? Description,
    string? CoverType,
    string? CoverValue,
    string EditorUrl);

sealed record ProjectOverride(
    string? Name,
    string? Description,
    string? CoverType,
    string? CoverValue);

sealed record ProjectMetadataRequest(
    string? Name,
    string? Description,
    string? CoverType,
    string? CoverValue);
