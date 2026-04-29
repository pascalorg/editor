
/**
 * Client
**/

import * as runtime from './runtime/library.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model User
 * 
 */
export type User = $Result.DefaultSelection<Prisma.$UserPayload>
/**
 * Model OnboardingProgress
 * 
 */
export type OnboardingProgress = $Result.DefaultSelection<Prisma.$OnboardingProgressPayload>
/**
 * Model Organization
 * 
 */
export type Organization = $Result.DefaultSelection<Prisma.$OrganizationPayload>
/**
 * Model OrganizationMember
 * 
 */
export type OrganizationMember = $Result.DefaultSelection<Prisma.$OrganizationMemberPayload>
/**
 * Model OrganizationInviteToken
 * 
 */
export type OrganizationInviteToken = $Result.DefaultSelection<Prisma.$OrganizationInviteTokenPayload>
/**
 * Model Team
 * 
 */
export type Team = $Result.DefaultSelection<Prisma.$TeamPayload>
/**
 * Model TeamMember
 * 
 */
export type TeamMember = $Result.DefaultSelection<Prisma.$TeamMemberPayload>
/**
 * Model Project
 * 
 */
export type Project = $Result.DefaultSelection<Prisma.$ProjectPayload>
/**
 * Model ProjectMember
 * 
 */
export type ProjectMember = $Result.DefaultSelection<Prisma.$ProjectMemberPayload>
/**
 * Model MarketplaceAsset
 * 
 */
export type MarketplaceAsset = $Result.DefaultSelection<Prisma.$MarketplaceAssetPayload>
/**
 * Model ProjectClone
 * 
 */
export type ProjectClone = $Result.DefaultSelection<Prisma.$ProjectClonePayload>
/**
 * Model EarlyAccessApplication
 * 
 */
export type EarlyAccessApplication = $Result.DefaultSelection<Prisma.$EarlyAccessApplicationPayload>
/**
 * Model PasswordResetToken
 * 
 */
export type PasswordResetToken = $Result.DefaultSelection<Prisma.$PasswordResetTokenPayload>

/**
 * Enums
 */
export namespace $Enums {
  export const OrgStatus: {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
};

export type OrgStatus = (typeof OrgStatus)[keyof typeof OrgStatus]


export const OrgRole: {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER'
};

export type OrgRole = (typeof OrgRole)[keyof typeof OrgRole]


export const ProjectRole: {
  OWNER: 'OWNER',
  EDITOR: 'EDITOR',
  VIEWER: 'VIEWER',
  COMMENTER: 'COMMENTER'
};

export type ProjectRole = (typeof ProjectRole)[keyof typeof ProjectRole]

}

export type OrgStatus = $Enums.OrgStatus

export const OrgStatus: typeof $Enums.OrgStatus

export type OrgRole = $Enums.OrgRole

export const OrgRole: typeof $Enums.OrgRole

export type ProjectRole = $Enums.ProjectRole

export const ProjectRole: typeof $Enums.ProjectRole

/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Users
 * const users = await prisma.user.findMany()
 * ```
 *
 * 
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  T extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  U = 'log' extends keyof T ? T['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<T['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   * 
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Users
   * const users = await prisma.user.findMany()
   * ```
   *
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<T, Prisma.PrismaClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): void;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

  /**
   * Add a middleware
   * @deprecated since 4.16.0. For new code, prefer client extensions instead.
   * @see https://pris.ly/d/extensions
   */
  $use(cb: Prisma.Middleware): void

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<'extends', Prisma.TypeMapCb, ExtArgs>

      /**
   * `prisma.user`: Exposes CRUD operations for the **User** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Users
    * const users = await prisma.user.findMany()
    * ```
    */
  get user(): Prisma.UserDelegate<ExtArgs>;

  /**
   * `prisma.onboardingProgress`: Exposes CRUD operations for the **OnboardingProgress** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more OnboardingProgresses
    * const onboardingProgresses = await prisma.onboardingProgress.findMany()
    * ```
    */
  get onboardingProgress(): Prisma.OnboardingProgressDelegate<ExtArgs>;

  /**
   * `prisma.organization`: Exposes CRUD operations for the **Organization** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Organizations
    * const organizations = await prisma.organization.findMany()
    * ```
    */
  get organization(): Prisma.OrganizationDelegate<ExtArgs>;

  /**
   * `prisma.organizationMember`: Exposes CRUD operations for the **OrganizationMember** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more OrganizationMembers
    * const organizationMembers = await prisma.organizationMember.findMany()
    * ```
    */
  get organizationMember(): Prisma.OrganizationMemberDelegate<ExtArgs>;

  /**
   * `prisma.organizationInviteToken`: Exposes CRUD operations for the **OrganizationInviteToken** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more OrganizationInviteTokens
    * const organizationInviteTokens = await prisma.organizationInviteToken.findMany()
    * ```
    */
  get organizationInviteToken(): Prisma.OrganizationInviteTokenDelegate<ExtArgs>;

  /**
   * `prisma.team`: Exposes CRUD operations for the **Team** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Teams
    * const teams = await prisma.team.findMany()
    * ```
    */
  get team(): Prisma.TeamDelegate<ExtArgs>;

  /**
   * `prisma.teamMember`: Exposes CRUD operations for the **TeamMember** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more TeamMembers
    * const teamMembers = await prisma.teamMember.findMany()
    * ```
    */
  get teamMember(): Prisma.TeamMemberDelegate<ExtArgs>;

  /**
   * `prisma.project`: Exposes CRUD operations for the **Project** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Projects
    * const projects = await prisma.project.findMany()
    * ```
    */
  get project(): Prisma.ProjectDelegate<ExtArgs>;

  /**
   * `prisma.projectMember`: Exposes CRUD operations for the **ProjectMember** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more ProjectMembers
    * const projectMembers = await prisma.projectMember.findMany()
    * ```
    */
  get projectMember(): Prisma.ProjectMemberDelegate<ExtArgs>;

  /**
   * `prisma.marketplaceAsset`: Exposes CRUD operations for the **MarketplaceAsset** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more MarketplaceAssets
    * const marketplaceAssets = await prisma.marketplaceAsset.findMany()
    * ```
    */
  get marketplaceAsset(): Prisma.MarketplaceAssetDelegate<ExtArgs>;

  /**
   * `prisma.projectClone`: Exposes CRUD operations for the **ProjectClone** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more ProjectClones
    * const projectClones = await prisma.projectClone.findMany()
    * ```
    */
  get projectClone(): Prisma.ProjectCloneDelegate<ExtArgs>;

  /**
   * `prisma.earlyAccessApplication`: Exposes CRUD operations for the **EarlyAccessApplication** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more EarlyAccessApplications
    * const earlyAccessApplications = await prisma.earlyAccessApplication.findMany()
    * ```
    */
  get earlyAccessApplication(): Prisma.EarlyAccessApplicationDelegate<ExtArgs>;

  /**
   * `prisma.passwordResetToken`: Exposes CRUD operations for the **PasswordResetToken** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more PasswordResetTokens
    * const passwordResetTokens = await prisma.passwordResetToken.findMany()
    * ```
    */
  get passwordResetToken(): Prisma.PasswordResetTokenDelegate<ExtArgs>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError
  export import NotFoundError = runtime.NotFoundError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql

  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics 
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 5.10.0
   * Query Engine version: 5a9203d0590c951969e85a7d07215503f4672eb9
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion 

  /**
   * Utility Types
   */

  /**
   * From https://github.com/sindresorhus/type-fest/
   * Matches a JSON object.
   * This type can be useful to enforce some input to be JSON-compatible or as a super-type to be extended from. 
   */
  export type JsonObject = {[Key in string]?: JsonValue}

  /**
   * From https://github.com/sindresorhus/type-fest/
   * Matches a JSON array.
   */
  export interface JsonArray extends Array<JsonValue> {}

  /**
   * From https://github.com/sindresorhus/type-fest/
   * Matches any valid JSON value.
   */
  export type JsonValue = string | number | boolean | JsonObject | JsonArray | null

  /**
   * Matches a JSON object.
   * Unlike `JsonObject`, this type allows undefined and read-only properties.
   */
  export type InputJsonObject = {readonly [Key in string]?: InputJsonValue | null}

  /**
   * Matches a JSON array.
   * Unlike `JsonArray`, readonly arrays are assignable to this type.
   */
  export interface InputJsonArray extends ReadonlyArray<InputJsonValue | null> {}

  /**
   * Matches any valid value that can be used as an input for operations like
   * create and update as the value of a JSON field. Unlike `JsonValue`, this
   * type allows read-only arrays and read-only object properties and disallows
   * `null` at the top level.
   *
   * `null` cannot be used as the value of a JSON field because its meaning
   * would be ambiguous. Use `Prisma.JsonNull` to store the JSON null value or
   * `Prisma.DbNull` to clear the JSON value and set the field to the database
   * NULL value instead.
   *
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-by-null-values
   */
  export type InputJsonValue = string | number | boolean | InputJsonObject | InputJsonArray | { toJSON(): unknown }

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? K : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    User: 'User',
    OnboardingProgress: 'OnboardingProgress',
    Organization: 'Organization',
    OrganizationMember: 'OrganizationMember',
    OrganizationInviteToken: 'OrganizationInviteToken',
    Team: 'Team',
    TeamMember: 'TeamMember',
    Project: 'Project',
    ProjectMember: 'ProjectMember',
    MarketplaceAsset: 'MarketplaceAsset',
    ProjectClone: 'ProjectClone',
    EarlyAccessApplication: 'EarlyAccessApplication',
    PasswordResetToken: 'PasswordResetToken'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }


  interface TypeMapCb extends $Utils.Fn<{extArgs: $Extensions.InternalArgs}, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs']>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    meta: {
      modelProps: 'user' | 'onboardingProgress' | 'organization' | 'organizationMember' | 'organizationInviteToken' | 'team' | 'teamMember' | 'project' | 'projectMember' | 'marketplaceAsset' | 'projectClone' | 'earlyAccessApplication' | 'passwordResetToken'
      txIsolationLevel: Prisma.TransactionIsolationLevel
    },
    model: {
      User: {
        payload: Prisma.$UserPayload<ExtArgs>
        fields: Prisma.UserFieldRefs
        operations: {
          findUnique: {
            args: Prisma.UserFindUniqueArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$UserPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.UserFindUniqueOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          findFirst: {
            args: Prisma.UserFindFirstArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$UserPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.UserFindFirstOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          findMany: {
            args: Prisma.UserFindManyArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$UserPayload>[]
          }
          create: {
            args: Prisma.UserCreateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          createMany: {
            args: Prisma.UserCreateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          delete: {
            args: Prisma.UserDeleteArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          update: {
            args: Prisma.UserUpdateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          deleteMany: {
            args: Prisma.UserDeleteManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          updateMany: {
            args: Prisma.UserUpdateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          upsert: {
            args: Prisma.UserUpsertArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          aggregate: {
            args: Prisma.UserAggregateArgs<ExtArgs>,
            result: $Utils.Optional<AggregateUser>
          }
          groupBy: {
            args: Prisma.UserGroupByArgs<ExtArgs>,
            result: $Utils.Optional<UserGroupByOutputType>[]
          }
          count: {
            args: Prisma.UserCountArgs<ExtArgs>,
            result: $Utils.Optional<UserCountAggregateOutputType> | number
          }
        }
      }
      OnboardingProgress: {
        payload: Prisma.$OnboardingProgressPayload<ExtArgs>
        fields: Prisma.OnboardingProgressFieldRefs
        operations: {
          findUnique: {
            args: Prisma.OnboardingProgressFindUniqueArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OnboardingProgressPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.OnboardingProgressFindUniqueOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OnboardingProgressPayload>
          }
          findFirst: {
            args: Prisma.OnboardingProgressFindFirstArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OnboardingProgressPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.OnboardingProgressFindFirstOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OnboardingProgressPayload>
          }
          findMany: {
            args: Prisma.OnboardingProgressFindManyArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OnboardingProgressPayload>[]
          }
          create: {
            args: Prisma.OnboardingProgressCreateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OnboardingProgressPayload>
          }
          createMany: {
            args: Prisma.OnboardingProgressCreateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          delete: {
            args: Prisma.OnboardingProgressDeleteArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OnboardingProgressPayload>
          }
          update: {
            args: Prisma.OnboardingProgressUpdateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OnboardingProgressPayload>
          }
          deleteMany: {
            args: Prisma.OnboardingProgressDeleteManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          updateMany: {
            args: Prisma.OnboardingProgressUpdateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          upsert: {
            args: Prisma.OnboardingProgressUpsertArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OnboardingProgressPayload>
          }
          aggregate: {
            args: Prisma.OnboardingProgressAggregateArgs<ExtArgs>,
            result: $Utils.Optional<AggregateOnboardingProgress>
          }
          groupBy: {
            args: Prisma.OnboardingProgressGroupByArgs<ExtArgs>,
            result: $Utils.Optional<OnboardingProgressGroupByOutputType>[]
          }
          count: {
            args: Prisma.OnboardingProgressCountArgs<ExtArgs>,
            result: $Utils.Optional<OnboardingProgressCountAggregateOutputType> | number
          }
        }
      }
      Organization: {
        payload: Prisma.$OrganizationPayload<ExtArgs>
        fields: Prisma.OrganizationFieldRefs
        operations: {
          findUnique: {
            args: Prisma.OrganizationFindUniqueArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.OrganizationFindUniqueOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload>
          }
          findFirst: {
            args: Prisma.OrganizationFindFirstArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.OrganizationFindFirstOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload>
          }
          findMany: {
            args: Prisma.OrganizationFindManyArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload>[]
          }
          create: {
            args: Prisma.OrganizationCreateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload>
          }
          createMany: {
            args: Prisma.OrganizationCreateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          delete: {
            args: Prisma.OrganizationDeleteArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload>
          }
          update: {
            args: Prisma.OrganizationUpdateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload>
          }
          deleteMany: {
            args: Prisma.OrganizationDeleteManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          updateMany: {
            args: Prisma.OrganizationUpdateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          upsert: {
            args: Prisma.OrganizationUpsertArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationPayload>
          }
          aggregate: {
            args: Prisma.OrganizationAggregateArgs<ExtArgs>,
            result: $Utils.Optional<AggregateOrganization>
          }
          groupBy: {
            args: Prisma.OrganizationGroupByArgs<ExtArgs>,
            result: $Utils.Optional<OrganizationGroupByOutputType>[]
          }
          count: {
            args: Prisma.OrganizationCountArgs<ExtArgs>,
            result: $Utils.Optional<OrganizationCountAggregateOutputType> | number
          }
        }
      }
      OrganizationMember: {
        payload: Prisma.$OrganizationMemberPayload<ExtArgs>
        fields: Prisma.OrganizationMemberFieldRefs
        operations: {
          findUnique: {
            args: Prisma.OrganizationMemberFindUniqueArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationMemberPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.OrganizationMemberFindUniqueOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationMemberPayload>
          }
          findFirst: {
            args: Prisma.OrganizationMemberFindFirstArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationMemberPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.OrganizationMemberFindFirstOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationMemberPayload>
          }
          findMany: {
            args: Prisma.OrganizationMemberFindManyArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationMemberPayload>[]
          }
          create: {
            args: Prisma.OrganizationMemberCreateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationMemberPayload>
          }
          createMany: {
            args: Prisma.OrganizationMemberCreateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          delete: {
            args: Prisma.OrganizationMemberDeleteArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationMemberPayload>
          }
          update: {
            args: Prisma.OrganizationMemberUpdateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationMemberPayload>
          }
          deleteMany: {
            args: Prisma.OrganizationMemberDeleteManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          updateMany: {
            args: Prisma.OrganizationMemberUpdateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          upsert: {
            args: Prisma.OrganizationMemberUpsertArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationMemberPayload>
          }
          aggregate: {
            args: Prisma.OrganizationMemberAggregateArgs<ExtArgs>,
            result: $Utils.Optional<AggregateOrganizationMember>
          }
          groupBy: {
            args: Prisma.OrganizationMemberGroupByArgs<ExtArgs>,
            result: $Utils.Optional<OrganizationMemberGroupByOutputType>[]
          }
          count: {
            args: Prisma.OrganizationMemberCountArgs<ExtArgs>,
            result: $Utils.Optional<OrganizationMemberCountAggregateOutputType> | number
          }
        }
      }
      OrganizationInviteToken: {
        payload: Prisma.$OrganizationInviteTokenPayload<ExtArgs>
        fields: Prisma.OrganizationInviteTokenFieldRefs
        operations: {
          findUnique: {
            args: Prisma.OrganizationInviteTokenFindUniqueArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationInviteTokenPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.OrganizationInviteTokenFindUniqueOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationInviteTokenPayload>
          }
          findFirst: {
            args: Prisma.OrganizationInviteTokenFindFirstArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationInviteTokenPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.OrganizationInviteTokenFindFirstOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationInviteTokenPayload>
          }
          findMany: {
            args: Prisma.OrganizationInviteTokenFindManyArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationInviteTokenPayload>[]
          }
          create: {
            args: Prisma.OrganizationInviteTokenCreateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationInviteTokenPayload>
          }
          createMany: {
            args: Prisma.OrganizationInviteTokenCreateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          delete: {
            args: Prisma.OrganizationInviteTokenDeleteArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationInviteTokenPayload>
          }
          update: {
            args: Prisma.OrganizationInviteTokenUpdateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationInviteTokenPayload>
          }
          deleteMany: {
            args: Prisma.OrganizationInviteTokenDeleteManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          updateMany: {
            args: Prisma.OrganizationInviteTokenUpdateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          upsert: {
            args: Prisma.OrganizationInviteTokenUpsertArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$OrganizationInviteTokenPayload>
          }
          aggregate: {
            args: Prisma.OrganizationInviteTokenAggregateArgs<ExtArgs>,
            result: $Utils.Optional<AggregateOrganizationInviteToken>
          }
          groupBy: {
            args: Prisma.OrganizationInviteTokenGroupByArgs<ExtArgs>,
            result: $Utils.Optional<OrganizationInviteTokenGroupByOutputType>[]
          }
          count: {
            args: Prisma.OrganizationInviteTokenCountArgs<ExtArgs>,
            result: $Utils.Optional<OrganizationInviteTokenCountAggregateOutputType> | number
          }
        }
      }
      Team: {
        payload: Prisma.$TeamPayload<ExtArgs>
        fields: Prisma.TeamFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TeamFindUniqueArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TeamFindUniqueOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamPayload>
          }
          findFirst: {
            args: Prisma.TeamFindFirstArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TeamFindFirstOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamPayload>
          }
          findMany: {
            args: Prisma.TeamFindManyArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamPayload>[]
          }
          create: {
            args: Prisma.TeamCreateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamPayload>
          }
          createMany: {
            args: Prisma.TeamCreateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          delete: {
            args: Prisma.TeamDeleteArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamPayload>
          }
          update: {
            args: Prisma.TeamUpdateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamPayload>
          }
          deleteMany: {
            args: Prisma.TeamDeleteManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          updateMany: {
            args: Prisma.TeamUpdateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          upsert: {
            args: Prisma.TeamUpsertArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamPayload>
          }
          aggregate: {
            args: Prisma.TeamAggregateArgs<ExtArgs>,
            result: $Utils.Optional<AggregateTeam>
          }
          groupBy: {
            args: Prisma.TeamGroupByArgs<ExtArgs>,
            result: $Utils.Optional<TeamGroupByOutputType>[]
          }
          count: {
            args: Prisma.TeamCountArgs<ExtArgs>,
            result: $Utils.Optional<TeamCountAggregateOutputType> | number
          }
        }
      }
      TeamMember: {
        payload: Prisma.$TeamMemberPayload<ExtArgs>
        fields: Prisma.TeamMemberFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TeamMemberFindUniqueArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamMemberPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TeamMemberFindUniqueOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamMemberPayload>
          }
          findFirst: {
            args: Prisma.TeamMemberFindFirstArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamMemberPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TeamMemberFindFirstOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamMemberPayload>
          }
          findMany: {
            args: Prisma.TeamMemberFindManyArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamMemberPayload>[]
          }
          create: {
            args: Prisma.TeamMemberCreateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamMemberPayload>
          }
          createMany: {
            args: Prisma.TeamMemberCreateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          delete: {
            args: Prisma.TeamMemberDeleteArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamMemberPayload>
          }
          update: {
            args: Prisma.TeamMemberUpdateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamMemberPayload>
          }
          deleteMany: {
            args: Prisma.TeamMemberDeleteManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          updateMany: {
            args: Prisma.TeamMemberUpdateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          upsert: {
            args: Prisma.TeamMemberUpsertArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$TeamMemberPayload>
          }
          aggregate: {
            args: Prisma.TeamMemberAggregateArgs<ExtArgs>,
            result: $Utils.Optional<AggregateTeamMember>
          }
          groupBy: {
            args: Prisma.TeamMemberGroupByArgs<ExtArgs>,
            result: $Utils.Optional<TeamMemberGroupByOutputType>[]
          }
          count: {
            args: Prisma.TeamMemberCountArgs<ExtArgs>,
            result: $Utils.Optional<TeamMemberCountAggregateOutputType> | number
          }
        }
      }
      Project: {
        payload: Prisma.$ProjectPayload<ExtArgs>
        fields: Prisma.ProjectFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ProjectFindUniqueArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ProjectFindUniqueOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload>
          }
          findFirst: {
            args: Prisma.ProjectFindFirstArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ProjectFindFirstOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload>
          }
          findMany: {
            args: Prisma.ProjectFindManyArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload>[]
          }
          create: {
            args: Prisma.ProjectCreateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload>
          }
          createMany: {
            args: Prisma.ProjectCreateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          delete: {
            args: Prisma.ProjectDeleteArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload>
          }
          update: {
            args: Prisma.ProjectUpdateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload>
          }
          deleteMany: {
            args: Prisma.ProjectDeleteManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          updateMany: {
            args: Prisma.ProjectUpdateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          upsert: {
            args: Prisma.ProjectUpsertArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectPayload>
          }
          aggregate: {
            args: Prisma.ProjectAggregateArgs<ExtArgs>,
            result: $Utils.Optional<AggregateProject>
          }
          groupBy: {
            args: Prisma.ProjectGroupByArgs<ExtArgs>,
            result: $Utils.Optional<ProjectGroupByOutputType>[]
          }
          count: {
            args: Prisma.ProjectCountArgs<ExtArgs>,
            result: $Utils.Optional<ProjectCountAggregateOutputType> | number
          }
        }
      }
      ProjectMember: {
        payload: Prisma.$ProjectMemberPayload<ExtArgs>
        fields: Prisma.ProjectMemberFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ProjectMemberFindUniqueArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectMemberPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ProjectMemberFindUniqueOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectMemberPayload>
          }
          findFirst: {
            args: Prisma.ProjectMemberFindFirstArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectMemberPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ProjectMemberFindFirstOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectMemberPayload>
          }
          findMany: {
            args: Prisma.ProjectMemberFindManyArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectMemberPayload>[]
          }
          create: {
            args: Prisma.ProjectMemberCreateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectMemberPayload>
          }
          createMany: {
            args: Prisma.ProjectMemberCreateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          delete: {
            args: Prisma.ProjectMemberDeleteArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectMemberPayload>
          }
          update: {
            args: Prisma.ProjectMemberUpdateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectMemberPayload>
          }
          deleteMany: {
            args: Prisma.ProjectMemberDeleteManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          updateMany: {
            args: Prisma.ProjectMemberUpdateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          upsert: {
            args: Prisma.ProjectMemberUpsertArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectMemberPayload>
          }
          aggregate: {
            args: Prisma.ProjectMemberAggregateArgs<ExtArgs>,
            result: $Utils.Optional<AggregateProjectMember>
          }
          groupBy: {
            args: Prisma.ProjectMemberGroupByArgs<ExtArgs>,
            result: $Utils.Optional<ProjectMemberGroupByOutputType>[]
          }
          count: {
            args: Prisma.ProjectMemberCountArgs<ExtArgs>,
            result: $Utils.Optional<ProjectMemberCountAggregateOutputType> | number
          }
        }
      }
      MarketplaceAsset: {
        payload: Prisma.$MarketplaceAssetPayload<ExtArgs>
        fields: Prisma.MarketplaceAssetFieldRefs
        operations: {
          findUnique: {
            args: Prisma.MarketplaceAssetFindUniqueArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$MarketplaceAssetPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.MarketplaceAssetFindUniqueOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$MarketplaceAssetPayload>
          }
          findFirst: {
            args: Prisma.MarketplaceAssetFindFirstArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$MarketplaceAssetPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.MarketplaceAssetFindFirstOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$MarketplaceAssetPayload>
          }
          findMany: {
            args: Prisma.MarketplaceAssetFindManyArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$MarketplaceAssetPayload>[]
          }
          create: {
            args: Prisma.MarketplaceAssetCreateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$MarketplaceAssetPayload>
          }
          createMany: {
            args: Prisma.MarketplaceAssetCreateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          delete: {
            args: Prisma.MarketplaceAssetDeleteArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$MarketplaceAssetPayload>
          }
          update: {
            args: Prisma.MarketplaceAssetUpdateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$MarketplaceAssetPayload>
          }
          deleteMany: {
            args: Prisma.MarketplaceAssetDeleteManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          updateMany: {
            args: Prisma.MarketplaceAssetUpdateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          upsert: {
            args: Prisma.MarketplaceAssetUpsertArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$MarketplaceAssetPayload>
          }
          aggregate: {
            args: Prisma.MarketplaceAssetAggregateArgs<ExtArgs>,
            result: $Utils.Optional<AggregateMarketplaceAsset>
          }
          groupBy: {
            args: Prisma.MarketplaceAssetGroupByArgs<ExtArgs>,
            result: $Utils.Optional<MarketplaceAssetGroupByOutputType>[]
          }
          count: {
            args: Prisma.MarketplaceAssetCountArgs<ExtArgs>,
            result: $Utils.Optional<MarketplaceAssetCountAggregateOutputType> | number
          }
        }
      }
      ProjectClone: {
        payload: Prisma.$ProjectClonePayload<ExtArgs>
        fields: Prisma.ProjectCloneFieldRefs
        operations: {
          findUnique: {
            args: Prisma.ProjectCloneFindUniqueArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectClonePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.ProjectCloneFindUniqueOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectClonePayload>
          }
          findFirst: {
            args: Prisma.ProjectCloneFindFirstArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectClonePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.ProjectCloneFindFirstOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectClonePayload>
          }
          findMany: {
            args: Prisma.ProjectCloneFindManyArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectClonePayload>[]
          }
          create: {
            args: Prisma.ProjectCloneCreateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectClonePayload>
          }
          createMany: {
            args: Prisma.ProjectCloneCreateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          delete: {
            args: Prisma.ProjectCloneDeleteArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectClonePayload>
          }
          update: {
            args: Prisma.ProjectCloneUpdateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectClonePayload>
          }
          deleteMany: {
            args: Prisma.ProjectCloneDeleteManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          updateMany: {
            args: Prisma.ProjectCloneUpdateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          upsert: {
            args: Prisma.ProjectCloneUpsertArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$ProjectClonePayload>
          }
          aggregate: {
            args: Prisma.ProjectCloneAggregateArgs<ExtArgs>,
            result: $Utils.Optional<AggregateProjectClone>
          }
          groupBy: {
            args: Prisma.ProjectCloneGroupByArgs<ExtArgs>,
            result: $Utils.Optional<ProjectCloneGroupByOutputType>[]
          }
          count: {
            args: Prisma.ProjectCloneCountArgs<ExtArgs>,
            result: $Utils.Optional<ProjectCloneCountAggregateOutputType> | number
          }
        }
      }
      EarlyAccessApplication: {
        payload: Prisma.$EarlyAccessApplicationPayload<ExtArgs>
        fields: Prisma.EarlyAccessApplicationFieldRefs
        operations: {
          findUnique: {
            args: Prisma.EarlyAccessApplicationFindUniqueArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$EarlyAccessApplicationPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.EarlyAccessApplicationFindUniqueOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$EarlyAccessApplicationPayload>
          }
          findFirst: {
            args: Prisma.EarlyAccessApplicationFindFirstArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$EarlyAccessApplicationPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.EarlyAccessApplicationFindFirstOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$EarlyAccessApplicationPayload>
          }
          findMany: {
            args: Prisma.EarlyAccessApplicationFindManyArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$EarlyAccessApplicationPayload>[]
          }
          create: {
            args: Prisma.EarlyAccessApplicationCreateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$EarlyAccessApplicationPayload>
          }
          createMany: {
            args: Prisma.EarlyAccessApplicationCreateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          delete: {
            args: Prisma.EarlyAccessApplicationDeleteArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$EarlyAccessApplicationPayload>
          }
          update: {
            args: Prisma.EarlyAccessApplicationUpdateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$EarlyAccessApplicationPayload>
          }
          deleteMany: {
            args: Prisma.EarlyAccessApplicationDeleteManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          updateMany: {
            args: Prisma.EarlyAccessApplicationUpdateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          upsert: {
            args: Prisma.EarlyAccessApplicationUpsertArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$EarlyAccessApplicationPayload>
          }
          aggregate: {
            args: Prisma.EarlyAccessApplicationAggregateArgs<ExtArgs>,
            result: $Utils.Optional<AggregateEarlyAccessApplication>
          }
          groupBy: {
            args: Prisma.EarlyAccessApplicationGroupByArgs<ExtArgs>,
            result: $Utils.Optional<EarlyAccessApplicationGroupByOutputType>[]
          }
          count: {
            args: Prisma.EarlyAccessApplicationCountArgs<ExtArgs>,
            result: $Utils.Optional<EarlyAccessApplicationCountAggregateOutputType> | number
          }
        }
      }
      PasswordResetToken: {
        payload: Prisma.$PasswordResetTokenPayload<ExtArgs>
        fields: Prisma.PasswordResetTokenFieldRefs
        operations: {
          findUnique: {
            args: Prisma.PasswordResetTokenFindUniqueArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$PasswordResetTokenPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.PasswordResetTokenFindUniqueOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$PasswordResetTokenPayload>
          }
          findFirst: {
            args: Prisma.PasswordResetTokenFindFirstArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$PasswordResetTokenPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.PasswordResetTokenFindFirstOrThrowArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$PasswordResetTokenPayload>
          }
          findMany: {
            args: Prisma.PasswordResetTokenFindManyArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$PasswordResetTokenPayload>[]
          }
          create: {
            args: Prisma.PasswordResetTokenCreateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$PasswordResetTokenPayload>
          }
          createMany: {
            args: Prisma.PasswordResetTokenCreateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          delete: {
            args: Prisma.PasswordResetTokenDeleteArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$PasswordResetTokenPayload>
          }
          update: {
            args: Prisma.PasswordResetTokenUpdateArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$PasswordResetTokenPayload>
          }
          deleteMany: {
            args: Prisma.PasswordResetTokenDeleteManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          updateMany: {
            args: Prisma.PasswordResetTokenUpdateManyArgs<ExtArgs>,
            result: Prisma.BatchPayload
          }
          upsert: {
            args: Prisma.PasswordResetTokenUpsertArgs<ExtArgs>,
            result: $Utils.PayloadToResult<Prisma.$PasswordResetTokenPayload>
          }
          aggregate: {
            args: Prisma.PasswordResetTokenAggregateArgs<ExtArgs>,
            result: $Utils.Optional<AggregatePasswordResetToken>
          }
          groupBy: {
            args: Prisma.PasswordResetTokenGroupByArgs<ExtArgs>,
            result: $Utils.Optional<PasswordResetTokenGroupByOutputType>[]
          }
          count: {
            args: Prisma.PasswordResetTokenCountArgs<ExtArgs>,
            result: $Utils.Optional<PasswordResetTokenCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<'define', Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Defaults to stdout
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events
     * log: [
     *   { emit: 'stdout', level: 'query' },
     *   { emit: 'stdout', level: 'info' },
     *   { emit: 'stdout', level: 'warn' }
     *   { emit: 'stdout', level: 'error' }
     * ]
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
  }

  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type GetLogType<T extends LogLevel | LogDefinition> = T extends LogDefinition ? T['emit'] extends 'event' ? T['level'] : never : never
  export type GetEvents<T extends any> = T extends Array<LogLevel | LogDefinition> ?
    GetLogType<T[0]> | GetLogType<T[1]> | GetLogType<T[2]> | GetLogType<T[3]>
    : never

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'update'
    | 'updateMany'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  /**
   * These options are being passed into the middleware as "params"
   */
  export type MiddlewareParams = {
    model?: ModelName
    action: PrismaAction
    args: any
    dataPath: string[]
    runInTransaction: boolean
  }

  /**
   * The `T` type makes sure, that the `return proceed` is not forgotten in the middleware implementation
   */
  export type Middleware<T = any> = (
    params: MiddlewareParams,
    next: (params: MiddlewareParams) => $Utils.JsPromise<T>,
  ) => $Utils.JsPromise<T>

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */


  /**
   * Count Type UserCountOutputType
   */

  export type UserCountOutputType = {
    organizations: number
    teamMemberships: number
    projectMemberships: number
    publishedAssets: number
    clonedProjects: number
  }

  export type UserCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organizations?: boolean | UserCountOutputTypeCountOrganizationsArgs
    teamMemberships?: boolean | UserCountOutputTypeCountTeamMembershipsArgs
    projectMemberships?: boolean | UserCountOutputTypeCountProjectMembershipsArgs
    publishedAssets?: boolean | UserCountOutputTypeCountPublishedAssetsArgs
    clonedProjects?: boolean | UserCountOutputTypeCountClonedProjectsArgs
  }

  // Custom InputTypes

  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserCountOutputType
     */
    select?: UserCountOutputTypeSelect<ExtArgs> | null
  }


  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeCountOrganizationsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: OrganizationMemberWhereInput
  }


  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeCountTeamMembershipsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TeamMemberWhereInput
  }


  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeCountProjectMembershipsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ProjectMemberWhereInput
  }


  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeCountPublishedAssetsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: MarketplaceAssetWhereInput
  }


  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeCountClonedProjectsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ProjectCloneWhereInput
  }



  /**
   * Count Type OrganizationCountOutputType
   */

  export type OrganizationCountOutputType = {
    members: number
    teams: number
    inviteTokens: number
  }

  export type OrganizationCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    members?: boolean | OrganizationCountOutputTypeCountMembersArgs
    teams?: boolean | OrganizationCountOutputTypeCountTeamsArgs
    inviteTokens?: boolean | OrganizationCountOutputTypeCountInviteTokensArgs
  }

  // Custom InputTypes

  /**
   * OrganizationCountOutputType without action
   */
  export type OrganizationCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationCountOutputType
     */
    select?: OrganizationCountOutputTypeSelect<ExtArgs> | null
  }


  /**
   * OrganizationCountOutputType without action
   */
  export type OrganizationCountOutputTypeCountMembersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: OrganizationMemberWhereInput
  }


  /**
   * OrganizationCountOutputType without action
   */
  export type OrganizationCountOutputTypeCountTeamsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TeamWhereInput
  }


  /**
   * OrganizationCountOutputType without action
   */
  export type OrganizationCountOutputTypeCountInviteTokensArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: OrganizationInviteTokenWhereInput
  }



  /**
   * Count Type TeamCountOutputType
   */

  export type TeamCountOutputType = {
    members: number
    projects: number
  }

  export type TeamCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    members?: boolean | TeamCountOutputTypeCountMembersArgs
    projects?: boolean | TeamCountOutputTypeCountProjectsArgs
  }

  // Custom InputTypes

  /**
   * TeamCountOutputType without action
   */
  export type TeamCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TeamCountOutputType
     */
    select?: TeamCountOutputTypeSelect<ExtArgs> | null
  }


  /**
   * TeamCountOutputType without action
   */
  export type TeamCountOutputTypeCountMembersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TeamMemberWhereInput
  }


  /**
   * TeamCountOutputType without action
   */
  export type TeamCountOutputTypeCountProjectsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ProjectWhereInput
  }



  /**
   * Count Type ProjectCountOutputType
   */

  export type ProjectCountOutputType = {
    members: number
  }

  export type ProjectCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    members?: boolean | ProjectCountOutputTypeCountMembersArgs
  }

  // Custom InputTypes

  /**
   * ProjectCountOutputType without action
   */
  export type ProjectCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectCountOutputType
     */
    select?: ProjectCountOutputTypeSelect<ExtArgs> | null
  }


  /**
   * ProjectCountOutputType without action
   */
  export type ProjectCountOutputTypeCountMembersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ProjectMemberWhereInput
  }



  /**
   * Count Type MarketplaceAssetCountOutputType
   */

  export type MarketplaceAssetCountOutputType = {
    clones: number
  }

  export type MarketplaceAssetCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    clones?: boolean | MarketplaceAssetCountOutputTypeCountClonesArgs
  }

  // Custom InputTypes

  /**
   * MarketplaceAssetCountOutputType without action
   */
  export type MarketplaceAssetCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MarketplaceAssetCountOutputType
     */
    select?: MarketplaceAssetCountOutputTypeSelect<ExtArgs> | null
  }


  /**
   * MarketplaceAssetCountOutputType without action
   */
  export type MarketplaceAssetCountOutputTypeCountClonesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ProjectCloneWhereInput
  }



  /**
   * Models
   */

  /**
   * Model User
   */

  export type AggregateUser = {
    _count: UserCountAggregateOutputType | null
    _min: UserMinAggregateOutputType | null
    _max: UserMaxAggregateOutputType | null
  }

  export type UserMinAggregateOutputType = {
    id: string | null
    name: string | null
    email: string | null
    emailVerified: Date | null
    image: string | null
    password: string | null
    bio: string | null
    onboardingComplete: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserMaxAggregateOutputType = {
    id: string | null
    name: string | null
    email: string | null
    emailVerified: Date | null
    image: string | null
    password: string | null
    bio: string | null
    onboardingComplete: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserCountAggregateOutputType = {
    id: number
    name: number
    email: number
    emailVerified: number
    image: number
    password: number
    bio: number
    onboardingComplete: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type UserMinAggregateInputType = {
    id?: true
    name?: true
    email?: true
    emailVerified?: true
    image?: true
    password?: true
    bio?: true
    onboardingComplete?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserMaxAggregateInputType = {
    id?: true
    name?: true
    email?: true
    emailVerified?: true
    image?: true
    password?: true
    bio?: true
    onboardingComplete?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserCountAggregateInputType = {
    id?: true
    name?: true
    email?: true
    emailVerified?: true
    image?: true
    password?: true
    bio?: true
    onboardingComplete?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type UserAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which User to aggregate.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Users
    **/
    _count?: true | UserCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: UserMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: UserMaxAggregateInputType
  }

  export type GetUserAggregateType<T extends UserAggregateArgs> = {
        [P in keyof T & keyof AggregateUser]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateUser[P]>
      : GetScalarType<T[P], AggregateUser[P]>
  }




  export type UserGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: UserWhereInput
    orderBy?: UserOrderByWithAggregationInput | UserOrderByWithAggregationInput[]
    by: UserScalarFieldEnum[] | UserScalarFieldEnum
    having?: UserScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: UserCountAggregateInputType | true
    _min?: UserMinAggregateInputType
    _max?: UserMaxAggregateInputType
  }

  export type UserGroupByOutputType = {
    id: string
    name: string | null
    email: string | null
    emailVerified: Date | null
    image: string | null
    password: string | null
    bio: string | null
    onboardingComplete: boolean
    createdAt: Date
    updatedAt: Date
    _count: UserCountAggregateOutputType | null
    _min: UserMinAggregateOutputType | null
    _max: UserMaxAggregateOutputType | null
  }

  type GetUserGroupByPayload<T extends UserGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<UserGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof UserGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], UserGroupByOutputType[P]>
            : GetScalarType<T[P], UserGroupByOutputType[P]>
        }
      >
    >


  export type UserSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    email?: boolean
    emailVerified?: boolean
    image?: boolean
    password?: boolean
    bio?: boolean
    onboardingComplete?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    onboardingProgress?: boolean | User$onboardingProgressArgs<ExtArgs>
    organizations?: boolean | User$organizationsArgs<ExtArgs>
    teamMemberships?: boolean | User$teamMembershipsArgs<ExtArgs>
    projectMemberships?: boolean | User$projectMembershipsArgs<ExtArgs>
    publishedAssets?: boolean | User$publishedAssetsArgs<ExtArgs>
    clonedProjects?: boolean | User$clonedProjectsArgs<ExtArgs>
    _count?: boolean | UserCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["user"]>

  export type UserSelectScalar = {
    id?: boolean
    name?: boolean
    email?: boolean
    emailVerified?: boolean
    image?: boolean
    password?: boolean
    bio?: boolean
    onboardingComplete?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type UserInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    onboardingProgress?: boolean | User$onboardingProgressArgs<ExtArgs>
    organizations?: boolean | User$organizationsArgs<ExtArgs>
    teamMemberships?: boolean | User$teamMembershipsArgs<ExtArgs>
    projectMemberships?: boolean | User$projectMembershipsArgs<ExtArgs>
    publishedAssets?: boolean | User$publishedAssetsArgs<ExtArgs>
    clonedProjects?: boolean | User$clonedProjectsArgs<ExtArgs>
    _count?: boolean | UserCountOutputTypeDefaultArgs<ExtArgs>
  }


  export type $UserPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "User"
    objects: {
      onboardingProgress: Prisma.$OnboardingProgressPayload<ExtArgs> | null
      organizations: Prisma.$OrganizationMemberPayload<ExtArgs>[]
      teamMemberships: Prisma.$TeamMemberPayload<ExtArgs>[]
      projectMemberships: Prisma.$ProjectMemberPayload<ExtArgs>[]
      publishedAssets: Prisma.$MarketplaceAssetPayload<ExtArgs>[]
      clonedProjects: Prisma.$ProjectClonePayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string | null
      email: string | null
      emailVerified: Date | null
      image: string | null
      password: string | null
      bio: string | null
      onboardingComplete: boolean
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["user"]>
    composites: {}
  }


  type UserGetPayload<S extends boolean | null | undefined | UserDefaultArgs> = $Result.GetResult<Prisma.$UserPayload, S>

  type UserCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<UserFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: UserCountAggregateInputType | true
    }

  export interface UserDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['User'], meta: { name: 'User' } }
    /**
     * Find zero or one User that matches the filter.
     * @param {UserFindUniqueArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends UserFindUniqueArgs<ExtArgs>>(
      args: SelectSubset<T, UserFindUniqueArgs<ExtArgs>>
    ): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, 'findUnique'> | null, null, ExtArgs>

    /**
     * Find one User that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {UserFindUniqueOrThrowArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends UserFindUniqueOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, UserFindUniqueOrThrowArgs<ExtArgs>>
    ): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, 'findUniqueOrThrow'>, never, ExtArgs>

    /**
     * Find the first User that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindFirstArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends UserFindFirstArgs<ExtArgs>>(
      args?: SelectSubset<T, UserFindFirstArgs<ExtArgs>>
    ): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, 'findFirst'> | null, null, ExtArgs>

    /**
     * Find the first User that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindFirstOrThrowArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends UserFindFirstOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, UserFindFirstOrThrowArgs<ExtArgs>>
    ): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, 'findFirstOrThrow'>, never, ExtArgs>

    /**
     * Find zero or more Users that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Users
     * const users = await prisma.user.findMany()
     * 
     * // Get first 10 Users
     * const users = await prisma.user.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const userWithIdOnly = await prisma.user.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends UserFindManyArgs<ExtArgs>>(
      args?: SelectSubset<T, UserFindManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, 'findMany'>>

    /**
     * Create a User.
     * @param {UserCreateArgs} args - Arguments to create a User.
     * @example
     * // Create one User
     * const User = await prisma.user.create({
     *   data: {
     *     // ... data to create a User
     *   }
     * })
     * 
    **/
    create<T extends UserCreateArgs<ExtArgs>>(
      args: SelectSubset<T, UserCreateArgs<ExtArgs>>
    ): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, 'create'>, never, ExtArgs>

    /**
     * Create many Users.
     *     @param {UserCreateManyArgs} args - Arguments to create many Users.
     *     @example
     *     // Create many Users
     *     const user = await prisma.user.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends UserCreateManyArgs<ExtArgs>>(
      args?: SelectSubset<T, UserCreateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a User.
     * @param {UserDeleteArgs} args - Arguments to delete one User.
     * @example
     * // Delete one User
     * const User = await prisma.user.delete({
     *   where: {
     *     // ... filter to delete one User
     *   }
     * })
     * 
    **/
    delete<T extends UserDeleteArgs<ExtArgs>>(
      args: SelectSubset<T, UserDeleteArgs<ExtArgs>>
    ): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, 'delete'>, never, ExtArgs>

    /**
     * Update one User.
     * @param {UserUpdateArgs} args - Arguments to update one User.
     * @example
     * // Update one User
     * const user = await prisma.user.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends UserUpdateArgs<ExtArgs>>(
      args: SelectSubset<T, UserUpdateArgs<ExtArgs>>
    ): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, 'update'>, never, ExtArgs>

    /**
     * Delete zero or more Users.
     * @param {UserDeleteManyArgs} args - Arguments to filter Users to delete.
     * @example
     * // Delete a few Users
     * const { count } = await prisma.user.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends UserDeleteManyArgs<ExtArgs>>(
      args?: SelectSubset<T, UserDeleteManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Users
     * const user = await prisma.user.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends UserUpdateManyArgs<ExtArgs>>(
      args: SelectSubset<T, UserUpdateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one User.
     * @param {UserUpsertArgs} args - Arguments to update or create a User.
     * @example
     * // Update or create a User
     * const user = await prisma.user.upsert({
     *   create: {
     *     // ... data to create a User
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the User we want to update
     *   }
     * })
    **/
    upsert<T extends UserUpsertArgs<ExtArgs>>(
      args: SelectSubset<T, UserUpsertArgs<ExtArgs>>
    ): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, 'upsert'>, never, ExtArgs>

    /**
     * Count the number of Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserCountArgs} args - Arguments to filter Users to count.
     * @example
     * // Count the number of Users
     * const count = await prisma.user.count({
     *   where: {
     *     // ... the filter for the Users we want to count
     *   }
     * })
    **/
    count<T extends UserCountArgs>(
      args?: Subset<T, UserCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], UserCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a User.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends UserAggregateArgs>(args: Subset<T, UserAggregateArgs>): Prisma.PrismaPromise<GetUserAggregateType<T>>

    /**
     * Group by User.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends UserGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: UserGroupByArgs['orderBy'] }
        : { orderBy?: UserGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, UserGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetUserGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the User model
   */
  readonly fields: UserFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for User.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__UserClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: 'PrismaPromise';

    onboardingProgress<T extends User$onboardingProgressArgs<ExtArgs> = {}>(args?: Subset<T, User$onboardingProgressArgs<ExtArgs>>): Prisma__OnboardingProgressClient<$Result.GetResult<Prisma.$OnboardingProgressPayload<ExtArgs>, T, 'findUniqueOrThrow'> | null, null, ExtArgs>;

    organizations<T extends User$organizationsArgs<ExtArgs> = {}>(args?: Subset<T, User$organizationsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$OrganizationMemberPayload<ExtArgs>, T, 'findMany'> | Null>;

    teamMemberships<T extends User$teamMembershipsArgs<ExtArgs> = {}>(args?: Subset<T, User$teamMembershipsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TeamMemberPayload<ExtArgs>, T, 'findMany'> | Null>;

    projectMemberships<T extends User$projectMembershipsArgs<ExtArgs> = {}>(args?: Subset<T, User$projectMembershipsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ProjectMemberPayload<ExtArgs>, T, 'findMany'> | Null>;

    publishedAssets<T extends User$publishedAssetsArgs<ExtArgs> = {}>(args?: Subset<T, User$publishedAssetsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MarketplaceAssetPayload<ExtArgs>, T, 'findMany'> | Null>;

    clonedProjects<T extends User$clonedProjectsArgs<ExtArgs> = {}>(args?: Subset<T, User$clonedProjectsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ProjectClonePayload<ExtArgs>, T, 'findMany'> | Null>;

    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>;
  }



  /**
   * Fields of the User model
   */ 
  interface UserFieldRefs {
    readonly id: FieldRef<"User", 'String'>
    readonly name: FieldRef<"User", 'String'>
    readonly email: FieldRef<"User", 'String'>
    readonly emailVerified: FieldRef<"User", 'DateTime'>
    readonly image: FieldRef<"User", 'String'>
    readonly password: FieldRef<"User", 'String'>
    readonly bio: FieldRef<"User", 'String'>
    readonly onboardingComplete: FieldRef<"User", 'Boolean'>
    readonly createdAt: FieldRef<"User", 'DateTime'>
    readonly updatedAt: FieldRef<"User", 'DateTime'>
  }
    

  // Custom InputTypes

  /**
   * User findUnique
   */
  export type UserFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where: UserWhereUniqueInput
  }


  /**
   * User findUniqueOrThrow
   */
  export type UserFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where: UserWhereUniqueInput
  }


  /**
   * User findFirst
   */
  export type UserFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Users.
     */
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }


  /**
   * User findFirstOrThrow
   */
  export type UserFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Users.
     */
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }


  /**
   * User findMany
   */
  export type UserFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which Users to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }


  /**
   * User create
   */
  export type UserCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * The data needed to create a User.
     */
    data: XOR<UserCreateInput, UserUncheckedCreateInput>
  }


  /**
   * User createMany
   */
  export type UserCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Users.
     */
    data: UserCreateManyInput | UserCreateManyInput[]
    skipDuplicates?: boolean
  }


  /**
   * User update
   */
  export type UserUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * The data needed to update a User.
     */
    data: XOR<UserUpdateInput, UserUncheckedUpdateInput>
    /**
     * Choose, which User to update.
     */
    where: UserWhereUniqueInput
  }


  /**
   * User updateMany
   */
  export type UserUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Users.
     */
    data: XOR<UserUpdateManyMutationInput, UserUncheckedUpdateManyInput>
    /**
     * Filter which Users to update
     */
    where?: UserWhereInput
  }


  /**
   * User upsert
   */
  export type UserUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * The filter to search for the User to update in case it exists.
     */
    where: UserWhereUniqueInput
    /**
     * In case the User found by the `where` argument doesn't exist, create a new User with this data.
     */
    create: XOR<UserCreateInput, UserUncheckedCreateInput>
    /**
     * In case the User was found with the provided `where` argument, update it with this data.
     */
    update: XOR<UserUpdateInput, UserUncheckedUpdateInput>
  }


  /**
   * User delete
   */
  export type UserDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter which User to delete.
     */
    where: UserWhereUniqueInput
  }


  /**
   * User deleteMany
   */
  export type UserDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Users to delete
     */
    where?: UserWhereInput
  }


  /**
   * User.onboardingProgress
   */
  export type User$onboardingProgressArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OnboardingProgress
     */
    select?: OnboardingProgressSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OnboardingProgressInclude<ExtArgs> | null
    where?: OnboardingProgressWhereInput
  }


  /**
   * User.organizations
   */
  export type User$organizationsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationMember
     */
    select?: OrganizationMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationMemberInclude<ExtArgs> | null
    where?: OrganizationMemberWhereInput
    orderBy?: OrganizationMemberOrderByWithRelationInput | OrganizationMemberOrderByWithRelationInput[]
    cursor?: OrganizationMemberWhereUniqueInput
    take?: number
    skip?: number
    distinct?: OrganizationMemberScalarFieldEnum | OrganizationMemberScalarFieldEnum[]
  }


  /**
   * User.teamMemberships
   */
  export type User$teamMembershipsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TeamMember
     */
    select?: TeamMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamMemberInclude<ExtArgs> | null
    where?: TeamMemberWhereInput
    orderBy?: TeamMemberOrderByWithRelationInput | TeamMemberOrderByWithRelationInput[]
    cursor?: TeamMemberWhereUniqueInput
    take?: number
    skip?: number
    distinct?: TeamMemberScalarFieldEnum | TeamMemberScalarFieldEnum[]
  }


  /**
   * User.projectMemberships
   */
  export type User$projectMembershipsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectMember
     */
    select?: ProjectMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectMemberInclude<ExtArgs> | null
    where?: ProjectMemberWhereInput
    orderBy?: ProjectMemberOrderByWithRelationInput | ProjectMemberOrderByWithRelationInput[]
    cursor?: ProjectMemberWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ProjectMemberScalarFieldEnum | ProjectMemberScalarFieldEnum[]
  }


  /**
   * User.publishedAssets
   */
  export type User$publishedAssetsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MarketplaceAsset
     */
    select?: MarketplaceAssetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: MarketplaceAssetInclude<ExtArgs> | null
    where?: MarketplaceAssetWhereInput
    orderBy?: MarketplaceAssetOrderByWithRelationInput | MarketplaceAssetOrderByWithRelationInput[]
    cursor?: MarketplaceAssetWhereUniqueInput
    take?: number
    skip?: number
    distinct?: MarketplaceAssetScalarFieldEnum | MarketplaceAssetScalarFieldEnum[]
  }


  /**
   * User.clonedProjects
   */
  export type User$clonedProjectsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectClone
     */
    select?: ProjectCloneSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectCloneInclude<ExtArgs> | null
    where?: ProjectCloneWhereInput
    orderBy?: ProjectCloneOrderByWithRelationInput | ProjectCloneOrderByWithRelationInput[]
    cursor?: ProjectCloneWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ProjectCloneScalarFieldEnum | ProjectCloneScalarFieldEnum[]
  }


  /**
   * User without action
   */
  export type UserDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: UserInclude<ExtArgs> | null
  }



  /**
   * Model OnboardingProgress
   */

  export type AggregateOnboardingProgress = {
    _count: OnboardingProgressCountAggregateOutputType | null
    _avg: OnboardingProgressAvgAggregateOutputType | null
    _sum: OnboardingProgressSumAggregateOutputType | null
    _min: OnboardingProgressMinAggregateOutputType | null
    _max: OnboardingProgressMaxAggregateOutputType | null
  }

  export type OnboardingProgressAvgAggregateOutputType = {
    currentStep: number | null
  }

  export type OnboardingProgressSumAggregateOutputType = {
    currentStep: number | null
  }

  export type OnboardingProgressMinAggregateOutputType = {
    userId: string | null
    currentStep: number | null
    completedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type OnboardingProgressMaxAggregateOutputType = {
    userId: string | null
    currentStep: number | null
    completedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type OnboardingProgressCountAggregateOutputType = {
    userId: number
    currentStep: number
    selections: number
    completedAt: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type OnboardingProgressAvgAggregateInputType = {
    currentStep?: true
  }

  export type OnboardingProgressSumAggregateInputType = {
    currentStep?: true
  }

  export type OnboardingProgressMinAggregateInputType = {
    userId?: true
    currentStep?: true
    completedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type OnboardingProgressMaxAggregateInputType = {
    userId?: true
    currentStep?: true
    completedAt?: true
    createdAt?: true
    updatedAt?: true
  }

  export type OnboardingProgressCountAggregateInputType = {
    userId?: true
    currentStep?: true
    selections?: true
    completedAt?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type OnboardingProgressAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which OnboardingProgress to aggregate.
     */
    where?: OnboardingProgressWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OnboardingProgresses to fetch.
     */
    orderBy?: OnboardingProgressOrderByWithRelationInput | OnboardingProgressOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: OnboardingProgressWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OnboardingProgresses from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OnboardingProgresses.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned OnboardingProgresses
    **/
    _count?: true | OnboardingProgressCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: OnboardingProgressAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: OnboardingProgressSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: OnboardingProgressMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: OnboardingProgressMaxAggregateInputType
  }

  export type GetOnboardingProgressAggregateType<T extends OnboardingProgressAggregateArgs> = {
        [P in keyof T & keyof AggregateOnboardingProgress]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateOnboardingProgress[P]>
      : GetScalarType<T[P], AggregateOnboardingProgress[P]>
  }




  export type OnboardingProgressGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: OnboardingProgressWhereInput
    orderBy?: OnboardingProgressOrderByWithAggregationInput | OnboardingProgressOrderByWithAggregationInput[]
    by: OnboardingProgressScalarFieldEnum[] | OnboardingProgressScalarFieldEnum
    having?: OnboardingProgressScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: OnboardingProgressCountAggregateInputType | true
    _avg?: OnboardingProgressAvgAggregateInputType
    _sum?: OnboardingProgressSumAggregateInputType
    _min?: OnboardingProgressMinAggregateInputType
    _max?: OnboardingProgressMaxAggregateInputType
  }

  export type OnboardingProgressGroupByOutputType = {
    userId: string
    currentStep: number
    selections: JsonValue
    completedAt: Date | null
    createdAt: Date
    updatedAt: Date
    _count: OnboardingProgressCountAggregateOutputType | null
    _avg: OnboardingProgressAvgAggregateOutputType | null
    _sum: OnboardingProgressSumAggregateOutputType | null
    _min: OnboardingProgressMinAggregateOutputType | null
    _max: OnboardingProgressMaxAggregateOutputType | null
  }

  type GetOnboardingProgressGroupByPayload<T extends OnboardingProgressGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<OnboardingProgressGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof OnboardingProgressGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], OnboardingProgressGroupByOutputType[P]>
            : GetScalarType<T[P], OnboardingProgressGroupByOutputType[P]>
        }
      >
    >


  export type OnboardingProgressSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    userId?: boolean
    currentStep?: boolean
    selections?: boolean
    completedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    user?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["onboardingProgress"]>

  export type OnboardingProgressSelectScalar = {
    userId?: boolean
    currentStep?: boolean
    selections?: boolean
    completedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type OnboardingProgressInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    user?: boolean | UserDefaultArgs<ExtArgs>
  }


  export type $OnboardingProgressPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "OnboardingProgress"
    objects: {
      user: Prisma.$UserPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      userId: string
      currentStep: number
      selections: Prisma.JsonValue
      completedAt: Date | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["onboardingProgress"]>
    composites: {}
  }


  type OnboardingProgressGetPayload<S extends boolean | null | undefined | OnboardingProgressDefaultArgs> = $Result.GetResult<Prisma.$OnboardingProgressPayload, S>

  type OnboardingProgressCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<OnboardingProgressFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: OnboardingProgressCountAggregateInputType | true
    }

  export interface OnboardingProgressDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['OnboardingProgress'], meta: { name: 'OnboardingProgress' } }
    /**
     * Find zero or one OnboardingProgress that matches the filter.
     * @param {OnboardingProgressFindUniqueArgs} args - Arguments to find a OnboardingProgress
     * @example
     * // Get one OnboardingProgress
     * const onboardingProgress = await prisma.onboardingProgress.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends OnboardingProgressFindUniqueArgs<ExtArgs>>(
      args: SelectSubset<T, OnboardingProgressFindUniqueArgs<ExtArgs>>
    ): Prisma__OnboardingProgressClient<$Result.GetResult<Prisma.$OnboardingProgressPayload<ExtArgs>, T, 'findUnique'> | null, null, ExtArgs>

    /**
     * Find one OnboardingProgress that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {OnboardingProgressFindUniqueOrThrowArgs} args - Arguments to find a OnboardingProgress
     * @example
     * // Get one OnboardingProgress
     * const onboardingProgress = await prisma.onboardingProgress.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends OnboardingProgressFindUniqueOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, OnboardingProgressFindUniqueOrThrowArgs<ExtArgs>>
    ): Prisma__OnboardingProgressClient<$Result.GetResult<Prisma.$OnboardingProgressPayload<ExtArgs>, T, 'findUniqueOrThrow'>, never, ExtArgs>

    /**
     * Find the first OnboardingProgress that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OnboardingProgressFindFirstArgs} args - Arguments to find a OnboardingProgress
     * @example
     * // Get one OnboardingProgress
     * const onboardingProgress = await prisma.onboardingProgress.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends OnboardingProgressFindFirstArgs<ExtArgs>>(
      args?: SelectSubset<T, OnboardingProgressFindFirstArgs<ExtArgs>>
    ): Prisma__OnboardingProgressClient<$Result.GetResult<Prisma.$OnboardingProgressPayload<ExtArgs>, T, 'findFirst'> | null, null, ExtArgs>

    /**
     * Find the first OnboardingProgress that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OnboardingProgressFindFirstOrThrowArgs} args - Arguments to find a OnboardingProgress
     * @example
     * // Get one OnboardingProgress
     * const onboardingProgress = await prisma.onboardingProgress.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends OnboardingProgressFindFirstOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, OnboardingProgressFindFirstOrThrowArgs<ExtArgs>>
    ): Prisma__OnboardingProgressClient<$Result.GetResult<Prisma.$OnboardingProgressPayload<ExtArgs>, T, 'findFirstOrThrow'>, never, ExtArgs>

    /**
     * Find zero or more OnboardingProgresses that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OnboardingProgressFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all OnboardingProgresses
     * const onboardingProgresses = await prisma.onboardingProgress.findMany()
     * 
     * // Get first 10 OnboardingProgresses
     * const onboardingProgresses = await prisma.onboardingProgress.findMany({ take: 10 })
     * 
     * // Only select the `userId`
     * const onboardingProgressWithUserIdOnly = await prisma.onboardingProgress.findMany({ select: { userId: true } })
     * 
    **/
    findMany<T extends OnboardingProgressFindManyArgs<ExtArgs>>(
      args?: SelectSubset<T, OnboardingProgressFindManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<$Result.GetResult<Prisma.$OnboardingProgressPayload<ExtArgs>, T, 'findMany'>>

    /**
     * Create a OnboardingProgress.
     * @param {OnboardingProgressCreateArgs} args - Arguments to create a OnboardingProgress.
     * @example
     * // Create one OnboardingProgress
     * const OnboardingProgress = await prisma.onboardingProgress.create({
     *   data: {
     *     // ... data to create a OnboardingProgress
     *   }
     * })
     * 
    **/
    create<T extends OnboardingProgressCreateArgs<ExtArgs>>(
      args: SelectSubset<T, OnboardingProgressCreateArgs<ExtArgs>>
    ): Prisma__OnboardingProgressClient<$Result.GetResult<Prisma.$OnboardingProgressPayload<ExtArgs>, T, 'create'>, never, ExtArgs>

    /**
     * Create many OnboardingProgresses.
     *     @param {OnboardingProgressCreateManyArgs} args - Arguments to create many OnboardingProgresses.
     *     @example
     *     // Create many OnboardingProgresses
     *     const onboardingProgress = await prisma.onboardingProgress.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends OnboardingProgressCreateManyArgs<ExtArgs>>(
      args?: SelectSubset<T, OnboardingProgressCreateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a OnboardingProgress.
     * @param {OnboardingProgressDeleteArgs} args - Arguments to delete one OnboardingProgress.
     * @example
     * // Delete one OnboardingProgress
     * const OnboardingProgress = await prisma.onboardingProgress.delete({
     *   where: {
     *     // ... filter to delete one OnboardingProgress
     *   }
     * })
     * 
    **/
    delete<T extends OnboardingProgressDeleteArgs<ExtArgs>>(
      args: SelectSubset<T, OnboardingProgressDeleteArgs<ExtArgs>>
    ): Prisma__OnboardingProgressClient<$Result.GetResult<Prisma.$OnboardingProgressPayload<ExtArgs>, T, 'delete'>, never, ExtArgs>

    /**
     * Update one OnboardingProgress.
     * @param {OnboardingProgressUpdateArgs} args - Arguments to update one OnboardingProgress.
     * @example
     * // Update one OnboardingProgress
     * const onboardingProgress = await prisma.onboardingProgress.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends OnboardingProgressUpdateArgs<ExtArgs>>(
      args: SelectSubset<T, OnboardingProgressUpdateArgs<ExtArgs>>
    ): Prisma__OnboardingProgressClient<$Result.GetResult<Prisma.$OnboardingProgressPayload<ExtArgs>, T, 'update'>, never, ExtArgs>

    /**
     * Delete zero or more OnboardingProgresses.
     * @param {OnboardingProgressDeleteManyArgs} args - Arguments to filter OnboardingProgresses to delete.
     * @example
     * // Delete a few OnboardingProgresses
     * const { count } = await prisma.onboardingProgress.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends OnboardingProgressDeleteManyArgs<ExtArgs>>(
      args?: SelectSubset<T, OnboardingProgressDeleteManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more OnboardingProgresses.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OnboardingProgressUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many OnboardingProgresses
     * const onboardingProgress = await prisma.onboardingProgress.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends OnboardingProgressUpdateManyArgs<ExtArgs>>(
      args: SelectSubset<T, OnboardingProgressUpdateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one OnboardingProgress.
     * @param {OnboardingProgressUpsertArgs} args - Arguments to update or create a OnboardingProgress.
     * @example
     * // Update or create a OnboardingProgress
     * const onboardingProgress = await prisma.onboardingProgress.upsert({
     *   create: {
     *     // ... data to create a OnboardingProgress
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the OnboardingProgress we want to update
     *   }
     * })
    **/
    upsert<T extends OnboardingProgressUpsertArgs<ExtArgs>>(
      args: SelectSubset<T, OnboardingProgressUpsertArgs<ExtArgs>>
    ): Prisma__OnboardingProgressClient<$Result.GetResult<Prisma.$OnboardingProgressPayload<ExtArgs>, T, 'upsert'>, never, ExtArgs>

    /**
     * Count the number of OnboardingProgresses.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OnboardingProgressCountArgs} args - Arguments to filter OnboardingProgresses to count.
     * @example
     * // Count the number of OnboardingProgresses
     * const count = await prisma.onboardingProgress.count({
     *   where: {
     *     // ... the filter for the OnboardingProgresses we want to count
     *   }
     * })
    **/
    count<T extends OnboardingProgressCountArgs>(
      args?: Subset<T, OnboardingProgressCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], OnboardingProgressCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a OnboardingProgress.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OnboardingProgressAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends OnboardingProgressAggregateArgs>(args: Subset<T, OnboardingProgressAggregateArgs>): Prisma.PrismaPromise<GetOnboardingProgressAggregateType<T>>

    /**
     * Group by OnboardingProgress.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OnboardingProgressGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends OnboardingProgressGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: OnboardingProgressGroupByArgs['orderBy'] }
        : { orderBy?: OnboardingProgressGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, OnboardingProgressGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetOnboardingProgressGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the OnboardingProgress model
   */
  readonly fields: OnboardingProgressFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for OnboardingProgress.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__OnboardingProgressClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: 'PrismaPromise';

    user<T extends UserDefaultArgs<ExtArgs> = {}>(args?: Subset<T, UserDefaultArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, 'findUniqueOrThrow'> | Null, Null, ExtArgs>;

    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>;
  }



  /**
   * Fields of the OnboardingProgress model
   */ 
  interface OnboardingProgressFieldRefs {
    readonly userId: FieldRef<"OnboardingProgress", 'String'>
    readonly currentStep: FieldRef<"OnboardingProgress", 'Int'>
    readonly selections: FieldRef<"OnboardingProgress", 'Json'>
    readonly completedAt: FieldRef<"OnboardingProgress", 'DateTime'>
    readonly createdAt: FieldRef<"OnboardingProgress", 'DateTime'>
    readonly updatedAt: FieldRef<"OnboardingProgress", 'DateTime'>
  }
    

  // Custom InputTypes

  /**
   * OnboardingProgress findUnique
   */
  export type OnboardingProgressFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OnboardingProgress
     */
    select?: OnboardingProgressSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OnboardingProgressInclude<ExtArgs> | null
    /**
     * Filter, which OnboardingProgress to fetch.
     */
    where: OnboardingProgressWhereUniqueInput
  }


  /**
   * OnboardingProgress findUniqueOrThrow
   */
  export type OnboardingProgressFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OnboardingProgress
     */
    select?: OnboardingProgressSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OnboardingProgressInclude<ExtArgs> | null
    /**
     * Filter, which OnboardingProgress to fetch.
     */
    where: OnboardingProgressWhereUniqueInput
  }


  /**
   * OnboardingProgress findFirst
   */
  export type OnboardingProgressFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OnboardingProgress
     */
    select?: OnboardingProgressSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OnboardingProgressInclude<ExtArgs> | null
    /**
     * Filter, which OnboardingProgress to fetch.
     */
    where?: OnboardingProgressWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OnboardingProgresses to fetch.
     */
    orderBy?: OnboardingProgressOrderByWithRelationInput | OnboardingProgressOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for OnboardingProgresses.
     */
    cursor?: OnboardingProgressWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OnboardingProgresses from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OnboardingProgresses.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of OnboardingProgresses.
     */
    distinct?: OnboardingProgressScalarFieldEnum | OnboardingProgressScalarFieldEnum[]
  }


  /**
   * OnboardingProgress findFirstOrThrow
   */
  export type OnboardingProgressFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OnboardingProgress
     */
    select?: OnboardingProgressSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OnboardingProgressInclude<ExtArgs> | null
    /**
     * Filter, which OnboardingProgress to fetch.
     */
    where?: OnboardingProgressWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OnboardingProgresses to fetch.
     */
    orderBy?: OnboardingProgressOrderByWithRelationInput | OnboardingProgressOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for OnboardingProgresses.
     */
    cursor?: OnboardingProgressWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OnboardingProgresses from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OnboardingProgresses.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of OnboardingProgresses.
     */
    distinct?: OnboardingProgressScalarFieldEnum | OnboardingProgressScalarFieldEnum[]
  }


  /**
   * OnboardingProgress findMany
   */
  export type OnboardingProgressFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OnboardingProgress
     */
    select?: OnboardingProgressSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OnboardingProgressInclude<ExtArgs> | null
    /**
     * Filter, which OnboardingProgresses to fetch.
     */
    where?: OnboardingProgressWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OnboardingProgresses to fetch.
     */
    orderBy?: OnboardingProgressOrderByWithRelationInput | OnboardingProgressOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing OnboardingProgresses.
     */
    cursor?: OnboardingProgressWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OnboardingProgresses from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OnboardingProgresses.
     */
    skip?: number
    distinct?: OnboardingProgressScalarFieldEnum | OnboardingProgressScalarFieldEnum[]
  }


  /**
   * OnboardingProgress create
   */
  export type OnboardingProgressCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OnboardingProgress
     */
    select?: OnboardingProgressSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OnboardingProgressInclude<ExtArgs> | null
    /**
     * The data needed to create a OnboardingProgress.
     */
    data: XOR<OnboardingProgressCreateInput, OnboardingProgressUncheckedCreateInput>
  }


  /**
   * OnboardingProgress createMany
   */
  export type OnboardingProgressCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many OnboardingProgresses.
     */
    data: OnboardingProgressCreateManyInput | OnboardingProgressCreateManyInput[]
    skipDuplicates?: boolean
  }


  /**
   * OnboardingProgress update
   */
  export type OnboardingProgressUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OnboardingProgress
     */
    select?: OnboardingProgressSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OnboardingProgressInclude<ExtArgs> | null
    /**
     * The data needed to update a OnboardingProgress.
     */
    data: XOR<OnboardingProgressUpdateInput, OnboardingProgressUncheckedUpdateInput>
    /**
     * Choose, which OnboardingProgress to update.
     */
    where: OnboardingProgressWhereUniqueInput
  }


  /**
   * OnboardingProgress updateMany
   */
  export type OnboardingProgressUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update OnboardingProgresses.
     */
    data: XOR<OnboardingProgressUpdateManyMutationInput, OnboardingProgressUncheckedUpdateManyInput>
    /**
     * Filter which OnboardingProgresses to update
     */
    where?: OnboardingProgressWhereInput
  }


  /**
   * OnboardingProgress upsert
   */
  export type OnboardingProgressUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OnboardingProgress
     */
    select?: OnboardingProgressSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OnboardingProgressInclude<ExtArgs> | null
    /**
     * The filter to search for the OnboardingProgress to update in case it exists.
     */
    where: OnboardingProgressWhereUniqueInput
    /**
     * In case the OnboardingProgress found by the `where` argument doesn't exist, create a new OnboardingProgress with this data.
     */
    create: XOR<OnboardingProgressCreateInput, OnboardingProgressUncheckedCreateInput>
    /**
     * In case the OnboardingProgress was found with the provided `where` argument, update it with this data.
     */
    update: XOR<OnboardingProgressUpdateInput, OnboardingProgressUncheckedUpdateInput>
  }


  /**
   * OnboardingProgress delete
   */
  export type OnboardingProgressDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OnboardingProgress
     */
    select?: OnboardingProgressSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OnboardingProgressInclude<ExtArgs> | null
    /**
     * Filter which OnboardingProgress to delete.
     */
    where: OnboardingProgressWhereUniqueInput
  }


  /**
   * OnboardingProgress deleteMany
   */
  export type OnboardingProgressDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which OnboardingProgresses to delete
     */
    where?: OnboardingProgressWhereInput
  }


  /**
   * OnboardingProgress without action
   */
  export type OnboardingProgressDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OnboardingProgress
     */
    select?: OnboardingProgressSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OnboardingProgressInclude<ExtArgs> | null
  }



  /**
   * Model Organization
   */

  export type AggregateOrganization = {
    _count: OrganizationCountAggregateOutputType | null
    _min: OrganizationMinAggregateOutputType | null
    _max: OrganizationMaxAggregateOutputType | null
  }

  export type OrganizationMinAggregateOutputType = {
    id: string | null
    name: string | null
    slug: string | null
    domain: string | null
    logoUrl: string | null
    status: $Enums.OrgStatus | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type OrganizationMaxAggregateOutputType = {
    id: string | null
    name: string | null
    slug: string | null
    domain: string | null
    logoUrl: string | null
    status: $Enums.OrgStatus | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type OrganizationCountAggregateOutputType = {
    id: number
    name: number
    slug: number
    domain: number
    logoUrl: number
    status: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type OrganizationMinAggregateInputType = {
    id?: true
    name?: true
    slug?: true
    domain?: true
    logoUrl?: true
    status?: true
    createdAt?: true
    updatedAt?: true
  }

  export type OrganizationMaxAggregateInputType = {
    id?: true
    name?: true
    slug?: true
    domain?: true
    logoUrl?: true
    status?: true
    createdAt?: true
    updatedAt?: true
  }

  export type OrganizationCountAggregateInputType = {
    id?: true
    name?: true
    slug?: true
    domain?: true
    logoUrl?: true
    status?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type OrganizationAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Organization to aggregate.
     */
    where?: OrganizationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Organizations to fetch.
     */
    orderBy?: OrganizationOrderByWithRelationInput | OrganizationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: OrganizationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Organizations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Organizations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Organizations
    **/
    _count?: true | OrganizationCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: OrganizationMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: OrganizationMaxAggregateInputType
  }

  export type GetOrganizationAggregateType<T extends OrganizationAggregateArgs> = {
        [P in keyof T & keyof AggregateOrganization]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateOrganization[P]>
      : GetScalarType<T[P], AggregateOrganization[P]>
  }




  export type OrganizationGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: OrganizationWhereInput
    orderBy?: OrganizationOrderByWithAggregationInput | OrganizationOrderByWithAggregationInput[]
    by: OrganizationScalarFieldEnum[] | OrganizationScalarFieldEnum
    having?: OrganizationScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: OrganizationCountAggregateInputType | true
    _min?: OrganizationMinAggregateInputType
    _max?: OrganizationMaxAggregateInputType
  }

  export type OrganizationGroupByOutputType = {
    id: string
    name: string
    slug: string
    domain: string | null
    logoUrl: string | null
    status: $Enums.OrgStatus
    createdAt: Date
    updatedAt: Date
    _count: OrganizationCountAggregateOutputType | null
    _min: OrganizationMinAggregateOutputType | null
    _max: OrganizationMaxAggregateOutputType | null
  }

  type GetOrganizationGroupByPayload<T extends OrganizationGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<OrganizationGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof OrganizationGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], OrganizationGroupByOutputType[P]>
            : GetScalarType<T[P], OrganizationGroupByOutputType[P]>
        }
      >
    >


  export type OrganizationSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    slug?: boolean
    domain?: boolean
    logoUrl?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    members?: boolean | Organization$membersArgs<ExtArgs>
    teams?: boolean | Organization$teamsArgs<ExtArgs>
    inviteTokens?: boolean | Organization$inviteTokensArgs<ExtArgs>
    _count?: boolean | OrganizationCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["organization"]>

  export type OrganizationSelectScalar = {
    id?: boolean
    name?: boolean
    slug?: boolean
    domain?: boolean
    logoUrl?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type OrganizationInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    members?: boolean | Organization$membersArgs<ExtArgs>
    teams?: boolean | Organization$teamsArgs<ExtArgs>
    inviteTokens?: boolean | Organization$inviteTokensArgs<ExtArgs>
    _count?: boolean | OrganizationCountOutputTypeDefaultArgs<ExtArgs>
  }


  export type $OrganizationPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Organization"
    objects: {
      members: Prisma.$OrganizationMemberPayload<ExtArgs>[]
      teams: Prisma.$TeamPayload<ExtArgs>[]
      inviteTokens: Prisma.$OrganizationInviteTokenPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      slug: string
      domain: string | null
      logoUrl: string | null
      status: $Enums.OrgStatus
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["organization"]>
    composites: {}
  }


  type OrganizationGetPayload<S extends boolean | null | undefined | OrganizationDefaultArgs> = $Result.GetResult<Prisma.$OrganizationPayload, S>

  type OrganizationCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<OrganizationFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: OrganizationCountAggregateInputType | true
    }

  export interface OrganizationDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Organization'], meta: { name: 'Organization' } }
    /**
     * Find zero or one Organization that matches the filter.
     * @param {OrganizationFindUniqueArgs} args - Arguments to find a Organization
     * @example
     * // Get one Organization
     * const organization = await prisma.organization.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends OrganizationFindUniqueArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationFindUniqueArgs<ExtArgs>>
    ): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, 'findUnique'> | null, null, ExtArgs>

    /**
     * Find one Organization that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {OrganizationFindUniqueOrThrowArgs} args - Arguments to find a Organization
     * @example
     * // Get one Organization
     * const organization = await prisma.organization.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends OrganizationFindUniqueOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationFindUniqueOrThrowArgs<ExtArgs>>
    ): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, 'findUniqueOrThrow'>, never, ExtArgs>

    /**
     * Find the first Organization that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationFindFirstArgs} args - Arguments to find a Organization
     * @example
     * // Get one Organization
     * const organization = await prisma.organization.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends OrganizationFindFirstArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationFindFirstArgs<ExtArgs>>
    ): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, 'findFirst'> | null, null, ExtArgs>

    /**
     * Find the first Organization that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationFindFirstOrThrowArgs} args - Arguments to find a Organization
     * @example
     * // Get one Organization
     * const organization = await prisma.organization.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends OrganizationFindFirstOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationFindFirstOrThrowArgs<ExtArgs>>
    ): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, 'findFirstOrThrow'>, never, ExtArgs>

    /**
     * Find zero or more Organizations that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Organizations
     * const organizations = await prisma.organization.findMany()
     * 
     * // Get first 10 Organizations
     * const organizations = await prisma.organization.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const organizationWithIdOnly = await prisma.organization.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends OrganizationFindManyArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationFindManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, 'findMany'>>

    /**
     * Create a Organization.
     * @param {OrganizationCreateArgs} args - Arguments to create a Organization.
     * @example
     * // Create one Organization
     * const Organization = await prisma.organization.create({
     *   data: {
     *     // ... data to create a Organization
     *   }
     * })
     * 
    **/
    create<T extends OrganizationCreateArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationCreateArgs<ExtArgs>>
    ): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, 'create'>, never, ExtArgs>

    /**
     * Create many Organizations.
     *     @param {OrganizationCreateManyArgs} args - Arguments to create many Organizations.
     *     @example
     *     // Create many Organizations
     *     const organization = await prisma.organization.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends OrganizationCreateManyArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationCreateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a Organization.
     * @param {OrganizationDeleteArgs} args - Arguments to delete one Organization.
     * @example
     * // Delete one Organization
     * const Organization = await prisma.organization.delete({
     *   where: {
     *     // ... filter to delete one Organization
     *   }
     * })
     * 
    **/
    delete<T extends OrganizationDeleteArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationDeleteArgs<ExtArgs>>
    ): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, 'delete'>, never, ExtArgs>

    /**
     * Update one Organization.
     * @param {OrganizationUpdateArgs} args - Arguments to update one Organization.
     * @example
     * // Update one Organization
     * const organization = await prisma.organization.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends OrganizationUpdateArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationUpdateArgs<ExtArgs>>
    ): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, 'update'>, never, ExtArgs>

    /**
     * Delete zero or more Organizations.
     * @param {OrganizationDeleteManyArgs} args - Arguments to filter Organizations to delete.
     * @example
     * // Delete a few Organizations
     * const { count } = await prisma.organization.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends OrganizationDeleteManyArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationDeleteManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Organizations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Organizations
     * const organization = await prisma.organization.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends OrganizationUpdateManyArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationUpdateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Organization.
     * @param {OrganizationUpsertArgs} args - Arguments to update or create a Organization.
     * @example
     * // Update or create a Organization
     * const organization = await prisma.organization.upsert({
     *   create: {
     *     // ... data to create a Organization
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Organization we want to update
     *   }
     * })
    **/
    upsert<T extends OrganizationUpsertArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationUpsertArgs<ExtArgs>>
    ): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, 'upsert'>, never, ExtArgs>

    /**
     * Count the number of Organizations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationCountArgs} args - Arguments to filter Organizations to count.
     * @example
     * // Count the number of Organizations
     * const count = await prisma.organization.count({
     *   where: {
     *     // ... the filter for the Organizations we want to count
     *   }
     * })
    **/
    count<T extends OrganizationCountArgs>(
      args?: Subset<T, OrganizationCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], OrganizationCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Organization.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends OrganizationAggregateArgs>(args: Subset<T, OrganizationAggregateArgs>): Prisma.PrismaPromise<GetOrganizationAggregateType<T>>

    /**
     * Group by Organization.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends OrganizationGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: OrganizationGroupByArgs['orderBy'] }
        : { orderBy?: OrganizationGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, OrganizationGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetOrganizationGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Organization model
   */
  readonly fields: OrganizationFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Organization.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__OrganizationClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: 'PrismaPromise';

    members<T extends Organization$membersArgs<ExtArgs> = {}>(args?: Subset<T, Organization$membersArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$OrganizationMemberPayload<ExtArgs>, T, 'findMany'> | Null>;

    teams<T extends Organization$teamsArgs<ExtArgs> = {}>(args?: Subset<T, Organization$teamsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TeamPayload<ExtArgs>, T, 'findMany'> | Null>;

    inviteTokens<T extends Organization$inviteTokensArgs<ExtArgs> = {}>(args?: Subset<T, Organization$inviteTokensArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$OrganizationInviteTokenPayload<ExtArgs>, T, 'findMany'> | Null>;

    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>;
  }



  /**
   * Fields of the Organization model
   */ 
  interface OrganizationFieldRefs {
    readonly id: FieldRef<"Organization", 'String'>
    readonly name: FieldRef<"Organization", 'String'>
    readonly slug: FieldRef<"Organization", 'String'>
    readonly domain: FieldRef<"Organization", 'String'>
    readonly logoUrl: FieldRef<"Organization", 'String'>
    readonly status: FieldRef<"Organization", 'OrgStatus'>
    readonly createdAt: FieldRef<"Organization", 'DateTime'>
    readonly updatedAt: FieldRef<"Organization", 'DateTime'>
  }
    

  // Custom InputTypes

  /**
   * Organization findUnique
   */
  export type OrganizationFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * Filter, which Organization to fetch.
     */
    where: OrganizationWhereUniqueInput
  }


  /**
   * Organization findUniqueOrThrow
   */
  export type OrganizationFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * Filter, which Organization to fetch.
     */
    where: OrganizationWhereUniqueInput
  }


  /**
   * Organization findFirst
   */
  export type OrganizationFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * Filter, which Organization to fetch.
     */
    where?: OrganizationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Organizations to fetch.
     */
    orderBy?: OrganizationOrderByWithRelationInput | OrganizationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Organizations.
     */
    cursor?: OrganizationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Organizations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Organizations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Organizations.
     */
    distinct?: OrganizationScalarFieldEnum | OrganizationScalarFieldEnum[]
  }


  /**
   * Organization findFirstOrThrow
   */
  export type OrganizationFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * Filter, which Organization to fetch.
     */
    where?: OrganizationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Organizations to fetch.
     */
    orderBy?: OrganizationOrderByWithRelationInput | OrganizationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Organizations.
     */
    cursor?: OrganizationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Organizations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Organizations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Organizations.
     */
    distinct?: OrganizationScalarFieldEnum | OrganizationScalarFieldEnum[]
  }


  /**
   * Organization findMany
   */
  export type OrganizationFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * Filter, which Organizations to fetch.
     */
    where?: OrganizationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Organizations to fetch.
     */
    orderBy?: OrganizationOrderByWithRelationInput | OrganizationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Organizations.
     */
    cursor?: OrganizationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Organizations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Organizations.
     */
    skip?: number
    distinct?: OrganizationScalarFieldEnum | OrganizationScalarFieldEnum[]
  }


  /**
   * Organization create
   */
  export type OrganizationCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * The data needed to create a Organization.
     */
    data: XOR<OrganizationCreateInput, OrganizationUncheckedCreateInput>
  }


  /**
   * Organization createMany
   */
  export type OrganizationCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Organizations.
     */
    data: OrganizationCreateManyInput | OrganizationCreateManyInput[]
    skipDuplicates?: boolean
  }


  /**
   * Organization update
   */
  export type OrganizationUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * The data needed to update a Organization.
     */
    data: XOR<OrganizationUpdateInput, OrganizationUncheckedUpdateInput>
    /**
     * Choose, which Organization to update.
     */
    where: OrganizationWhereUniqueInput
  }


  /**
   * Organization updateMany
   */
  export type OrganizationUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Organizations.
     */
    data: XOR<OrganizationUpdateManyMutationInput, OrganizationUncheckedUpdateManyInput>
    /**
     * Filter which Organizations to update
     */
    where?: OrganizationWhereInput
  }


  /**
   * Organization upsert
   */
  export type OrganizationUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * The filter to search for the Organization to update in case it exists.
     */
    where: OrganizationWhereUniqueInput
    /**
     * In case the Organization found by the `where` argument doesn't exist, create a new Organization with this data.
     */
    create: XOR<OrganizationCreateInput, OrganizationUncheckedCreateInput>
    /**
     * In case the Organization was found with the provided `where` argument, update it with this data.
     */
    update: XOR<OrganizationUpdateInput, OrganizationUncheckedUpdateInput>
  }


  /**
   * Organization delete
   */
  export type OrganizationDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInclude<ExtArgs> | null
    /**
     * Filter which Organization to delete.
     */
    where: OrganizationWhereUniqueInput
  }


  /**
   * Organization deleteMany
   */
  export type OrganizationDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Organizations to delete
     */
    where?: OrganizationWhereInput
  }


  /**
   * Organization.members
   */
  export type Organization$membersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationMember
     */
    select?: OrganizationMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationMemberInclude<ExtArgs> | null
    where?: OrganizationMemberWhereInput
    orderBy?: OrganizationMemberOrderByWithRelationInput | OrganizationMemberOrderByWithRelationInput[]
    cursor?: OrganizationMemberWhereUniqueInput
    take?: number
    skip?: number
    distinct?: OrganizationMemberScalarFieldEnum | OrganizationMemberScalarFieldEnum[]
  }


  /**
   * Organization.teams
   */
  export type Organization$teamsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Team
     */
    select?: TeamSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamInclude<ExtArgs> | null
    where?: TeamWhereInput
    orderBy?: TeamOrderByWithRelationInput | TeamOrderByWithRelationInput[]
    cursor?: TeamWhereUniqueInput
    take?: number
    skip?: number
    distinct?: TeamScalarFieldEnum | TeamScalarFieldEnum[]
  }


  /**
   * Organization.inviteTokens
   */
  export type Organization$inviteTokensArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationInviteToken
     */
    select?: OrganizationInviteTokenSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInviteTokenInclude<ExtArgs> | null
    where?: OrganizationInviteTokenWhereInput
    orderBy?: OrganizationInviteTokenOrderByWithRelationInput | OrganizationInviteTokenOrderByWithRelationInput[]
    cursor?: OrganizationInviteTokenWhereUniqueInput
    take?: number
    skip?: number
    distinct?: OrganizationInviteTokenScalarFieldEnum | OrganizationInviteTokenScalarFieldEnum[]
  }


  /**
   * Organization without action
   */
  export type OrganizationDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Organization
     */
    select?: OrganizationSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInclude<ExtArgs> | null
  }



  /**
   * Model OrganizationMember
   */

  export type AggregateOrganizationMember = {
    _count: OrganizationMemberCountAggregateOutputType | null
    _min: OrganizationMemberMinAggregateOutputType | null
    _max: OrganizationMemberMaxAggregateOutputType | null
  }

  export type OrganizationMemberMinAggregateOutputType = {
    id: string | null
    organizationId: string | null
    userId: string | null
    role: $Enums.OrgRole | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type OrganizationMemberMaxAggregateOutputType = {
    id: string | null
    organizationId: string | null
    userId: string | null
    role: $Enums.OrgRole | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type OrganizationMemberCountAggregateOutputType = {
    id: number
    organizationId: number
    userId: number
    role: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type OrganizationMemberMinAggregateInputType = {
    id?: true
    organizationId?: true
    userId?: true
    role?: true
    createdAt?: true
    updatedAt?: true
  }

  export type OrganizationMemberMaxAggregateInputType = {
    id?: true
    organizationId?: true
    userId?: true
    role?: true
    createdAt?: true
    updatedAt?: true
  }

  export type OrganizationMemberCountAggregateInputType = {
    id?: true
    organizationId?: true
    userId?: true
    role?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type OrganizationMemberAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which OrganizationMember to aggregate.
     */
    where?: OrganizationMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OrganizationMembers to fetch.
     */
    orderBy?: OrganizationMemberOrderByWithRelationInput | OrganizationMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: OrganizationMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OrganizationMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OrganizationMembers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned OrganizationMembers
    **/
    _count?: true | OrganizationMemberCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: OrganizationMemberMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: OrganizationMemberMaxAggregateInputType
  }

  export type GetOrganizationMemberAggregateType<T extends OrganizationMemberAggregateArgs> = {
        [P in keyof T & keyof AggregateOrganizationMember]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateOrganizationMember[P]>
      : GetScalarType<T[P], AggregateOrganizationMember[P]>
  }




  export type OrganizationMemberGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: OrganizationMemberWhereInput
    orderBy?: OrganizationMemberOrderByWithAggregationInput | OrganizationMemberOrderByWithAggregationInput[]
    by: OrganizationMemberScalarFieldEnum[] | OrganizationMemberScalarFieldEnum
    having?: OrganizationMemberScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: OrganizationMemberCountAggregateInputType | true
    _min?: OrganizationMemberMinAggregateInputType
    _max?: OrganizationMemberMaxAggregateInputType
  }

  export type OrganizationMemberGroupByOutputType = {
    id: string
    organizationId: string
    userId: string
    role: $Enums.OrgRole
    createdAt: Date
    updatedAt: Date
    _count: OrganizationMemberCountAggregateOutputType | null
    _min: OrganizationMemberMinAggregateOutputType | null
    _max: OrganizationMemberMaxAggregateOutputType | null
  }

  type GetOrganizationMemberGroupByPayload<T extends OrganizationMemberGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<OrganizationMemberGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof OrganizationMemberGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], OrganizationMemberGroupByOutputType[P]>
            : GetScalarType<T[P], OrganizationMemberGroupByOutputType[P]>
        }
      >
    >


  export type OrganizationMemberSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    userId?: boolean
    role?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["organizationMember"]>

  export type OrganizationMemberSelectScalar = {
    id?: boolean
    organizationId?: boolean
    userId?: boolean
    role?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type OrganizationMemberInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }


  export type $OrganizationMemberPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "OrganizationMember"
    objects: {
      organization: Prisma.$OrganizationPayload<ExtArgs>
      user: Prisma.$UserPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      organizationId: string
      userId: string
      role: $Enums.OrgRole
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["organizationMember"]>
    composites: {}
  }


  type OrganizationMemberGetPayload<S extends boolean | null | undefined | OrganizationMemberDefaultArgs> = $Result.GetResult<Prisma.$OrganizationMemberPayload, S>

  type OrganizationMemberCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<OrganizationMemberFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: OrganizationMemberCountAggregateInputType | true
    }

  export interface OrganizationMemberDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['OrganizationMember'], meta: { name: 'OrganizationMember' } }
    /**
     * Find zero or one OrganizationMember that matches the filter.
     * @param {OrganizationMemberFindUniqueArgs} args - Arguments to find a OrganizationMember
     * @example
     * // Get one OrganizationMember
     * const organizationMember = await prisma.organizationMember.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends OrganizationMemberFindUniqueArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationMemberFindUniqueArgs<ExtArgs>>
    ): Prisma__OrganizationMemberClient<$Result.GetResult<Prisma.$OrganizationMemberPayload<ExtArgs>, T, 'findUnique'> | null, null, ExtArgs>

    /**
     * Find one OrganizationMember that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {OrganizationMemberFindUniqueOrThrowArgs} args - Arguments to find a OrganizationMember
     * @example
     * // Get one OrganizationMember
     * const organizationMember = await prisma.organizationMember.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends OrganizationMemberFindUniqueOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationMemberFindUniqueOrThrowArgs<ExtArgs>>
    ): Prisma__OrganizationMemberClient<$Result.GetResult<Prisma.$OrganizationMemberPayload<ExtArgs>, T, 'findUniqueOrThrow'>, never, ExtArgs>

    /**
     * Find the first OrganizationMember that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationMemberFindFirstArgs} args - Arguments to find a OrganizationMember
     * @example
     * // Get one OrganizationMember
     * const organizationMember = await prisma.organizationMember.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends OrganizationMemberFindFirstArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationMemberFindFirstArgs<ExtArgs>>
    ): Prisma__OrganizationMemberClient<$Result.GetResult<Prisma.$OrganizationMemberPayload<ExtArgs>, T, 'findFirst'> | null, null, ExtArgs>

    /**
     * Find the first OrganizationMember that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationMemberFindFirstOrThrowArgs} args - Arguments to find a OrganizationMember
     * @example
     * // Get one OrganizationMember
     * const organizationMember = await prisma.organizationMember.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends OrganizationMemberFindFirstOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationMemberFindFirstOrThrowArgs<ExtArgs>>
    ): Prisma__OrganizationMemberClient<$Result.GetResult<Prisma.$OrganizationMemberPayload<ExtArgs>, T, 'findFirstOrThrow'>, never, ExtArgs>

    /**
     * Find zero or more OrganizationMembers that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationMemberFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all OrganizationMembers
     * const organizationMembers = await prisma.organizationMember.findMany()
     * 
     * // Get first 10 OrganizationMembers
     * const organizationMembers = await prisma.organizationMember.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const organizationMemberWithIdOnly = await prisma.organizationMember.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends OrganizationMemberFindManyArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationMemberFindManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<$Result.GetResult<Prisma.$OrganizationMemberPayload<ExtArgs>, T, 'findMany'>>

    /**
     * Create a OrganizationMember.
     * @param {OrganizationMemberCreateArgs} args - Arguments to create a OrganizationMember.
     * @example
     * // Create one OrganizationMember
     * const OrganizationMember = await prisma.organizationMember.create({
     *   data: {
     *     // ... data to create a OrganizationMember
     *   }
     * })
     * 
    **/
    create<T extends OrganizationMemberCreateArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationMemberCreateArgs<ExtArgs>>
    ): Prisma__OrganizationMemberClient<$Result.GetResult<Prisma.$OrganizationMemberPayload<ExtArgs>, T, 'create'>, never, ExtArgs>

    /**
     * Create many OrganizationMembers.
     *     @param {OrganizationMemberCreateManyArgs} args - Arguments to create many OrganizationMembers.
     *     @example
     *     // Create many OrganizationMembers
     *     const organizationMember = await prisma.organizationMember.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends OrganizationMemberCreateManyArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationMemberCreateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a OrganizationMember.
     * @param {OrganizationMemberDeleteArgs} args - Arguments to delete one OrganizationMember.
     * @example
     * // Delete one OrganizationMember
     * const OrganizationMember = await prisma.organizationMember.delete({
     *   where: {
     *     // ... filter to delete one OrganizationMember
     *   }
     * })
     * 
    **/
    delete<T extends OrganizationMemberDeleteArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationMemberDeleteArgs<ExtArgs>>
    ): Prisma__OrganizationMemberClient<$Result.GetResult<Prisma.$OrganizationMemberPayload<ExtArgs>, T, 'delete'>, never, ExtArgs>

    /**
     * Update one OrganizationMember.
     * @param {OrganizationMemberUpdateArgs} args - Arguments to update one OrganizationMember.
     * @example
     * // Update one OrganizationMember
     * const organizationMember = await prisma.organizationMember.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends OrganizationMemberUpdateArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationMemberUpdateArgs<ExtArgs>>
    ): Prisma__OrganizationMemberClient<$Result.GetResult<Prisma.$OrganizationMemberPayload<ExtArgs>, T, 'update'>, never, ExtArgs>

    /**
     * Delete zero or more OrganizationMembers.
     * @param {OrganizationMemberDeleteManyArgs} args - Arguments to filter OrganizationMembers to delete.
     * @example
     * // Delete a few OrganizationMembers
     * const { count } = await prisma.organizationMember.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends OrganizationMemberDeleteManyArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationMemberDeleteManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more OrganizationMembers.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationMemberUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many OrganizationMembers
     * const organizationMember = await prisma.organizationMember.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends OrganizationMemberUpdateManyArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationMemberUpdateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one OrganizationMember.
     * @param {OrganizationMemberUpsertArgs} args - Arguments to update or create a OrganizationMember.
     * @example
     * // Update or create a OrganizationMember
     * const organizationMember = await prisma.organizationMember.upsert({
     *   create: {
     *     // ... data to create a OrganizationMember
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the OrganizationMember we want to update
     *   }
     * })
    **/
    upsert<T extends OrganizationMemberUpsertArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationMemberUpsertArgs<ExtArgs>>
    ): Prisma__OrganizationMemberClient<$Result.GetResult<Prisma.$OrganizationMemberPayload<ExtArgs>, T, 'upsert'>, never, ExtArgs>

    /**
     * Count the number of OrganizationMembers.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationMemberCountArgs} args - Arguments to filter OrganizationMembers to count.
     * @example
     * // Count the number of OrganizationMembers
     * const count = await prisma.organizationMember.count({
     *   where: {
     *     // ... the filter for the OrganizationMembers we want to count
     *   }
     * })
    **/
    count<T extends OrganizationMemberCountArgs>(
      args?: Subset<T, OrganizationMemberCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], OrganizationMemberCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a OrganizationMember.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationMemberAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends OrganizationMemberAggregateArgs>(args: Subset<T, OrganizationMemberAggregateArgs>): Prisma.PrismaPromise<GetOrganizationMemberAggregateType<T>>

    /**
     * Group by OrganizationMember.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationMemberGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends OrganizationMemberGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: OrganizationMemberGroupByArgs['orderBy'] }
        : { orderBy?: OrganizationMemberGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, OrganizationMemberGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetOrganizationMemberGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the OrganizationMember model
   */
  readonly fields: OrganizationMemberFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for OrganizationMember.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__OrganizationMemberClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: 'PrismaPromise';

    organization<T extends OrganizationDefaultArgs<ExtArgs> = {}>(args?: Subset<T, OrganizationDefaultArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, 'findUniqueOrThrow'> | Null, Null, ExtArgs>;

    user<T extends UserDefaultArgs<ExtArgs> = {}>(args?: Subset<T, UserDefaultArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, 'findUniqueOrThrow'> | Null, Null, ExtArgs>;

    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>;
  }



  /**
   * Fields of the OrganizationMember model
   */ 
  interface OrganizationMemberFieldRefs {
    readonly id: FieldRef<"OrganizationMember", 'String'>
    readonly organizationId: FieldRef<"OrganizationMember", 'String'>
    readonly userId: FieldRef<"OrganizationMember", 'String'>
    readonly role: FieldRef<"OrganizationMember", 'OrgRole'>
    readonly createdAt: FieldRef<"OrganizationMember", 'DateTime'>
    readonly updatedAt: FieldRef<"OrganizationMember", 'DateTime'>
  }
    

  // Custom InputTypes

  /**
   * OrganizationMember findUnique
   */
  export type OrganizationMemberFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationMember
     */
    select?: OrganizationMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationMemberInclude<ExtArgs> | null
    /**
     * Filter, which OrganizationMember to fetch.
     */
    where: OrganizationMemberWhereUniqueInput
  }


  /**
   * OrganizationMember findUniqueOrThrow
   */
  export type OrganizationMemberFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationMember
     */
    select?: OrganizationMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationMemberInclude<ExtArgs> | null
    /**
     * Filter, which OrganizationMember to fetch.
     */
    where: OrganizationMemberWhereUniqueInput
  }


  /**
   * OrganizationMember findFirst
   */
  export type OrganizationMemberFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationMember
     */
    select?: OrganizationMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationMemberInclude<ExtArgs> | null
    /**
     * Filter, which OrganizationMember to fetch.
     */
    where?: OrganizationMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OrganizationMembers to fetch.
     */
    orderBy?: OrganizationMemberOrderByWithRelationInput | OrganizationMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for OrganizationMembers.
     */
    cursor?: OrganizationMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OrganizationMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OrganizationMembers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of OrganizationMembers.
     */
    distinct?: OrganizationMemberScalarFieldEnum | OrganizationMemberScalarFieldEnum[]
  }


  /**
   * OrganizationMember findFirstOrThrow
   */
  export type OrganizationMemberFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationMember
     */
    select?: OrganizationMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationMemberInclude<ExtArgs> | null
    /**
     * Filter, which OrganizationMember to fetch.
     */
    where?: OrganizationMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OrganizationMembers to fetch.
     */
    orderBy?: OrganizationMemberOrderByWithRelationInput | OrganizationMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for OrganizationMembers.
     */
    cursor?: OrganizationMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OrganizationMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OrganizationMembers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of OrganizationMembers.
     */
    distinct?: OrganizationMemberScalarFieldEnum | OrganizationMemberScalarFieldEnum[]
  }


  /**
   * OrganizationMember findMany
   */
  export type OrganizationMemberFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationMember
     */
    select?: OrganizationMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationMemberInclude<ExtArgs> | null
    /**
     * Filter, which OrganizationMembers to fetch.
     */
    where?: OrganizationMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OrganizationMembers to fetch.
     */
    orderBy?: OrganizationMemberOrderByWithRelationInput | OrganizationMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing OrganizationMembers.
     */
    cursor?: OrganizationMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OrganizationMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OrganizationMembers.
     */
    skip?: number
    distinct?: OrganizationMemberScalarFieldEnum | OrganizationMemberScalarFieldEnum[]
  }


  /**
   * OrganizationMember create
   */
  export type OrganizationMemberCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationMember
     */
    select?: OrganizationMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationMemberInclude<ExtArgs> | null
    /**
     * The data needed to create a OrganizationMember.
     */
    data: XOR<OrganizationMemberCreateInput, OrganizationMemberUncheckedCreateInput>
  }


  /**
   * OrganizationMember createMany
   */
  export type OrganizationMemberCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many OrganizationMembers.
     */
    data: OrganizationMemberCreateManyInput | OrganizationMemberCreateManyInput[]
    skipDuplicates?: boolean
  }


  /**
   * OrganizationMember update
   */
  export type OrganizationMemberUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationMember
     */
    select?: OrganizationMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationMemberInclude<ExtArgs> | null
    /**
     * The data needed to update a OrganizationMember.
     */
    data: XOR<OrganizationMemberUpdateInput, OrganizationMemberUncheckedUpdateInput>
    /**
     * Choose, which OrganizationMember to update.
     */
    where: OrganizationMemberWhereUniqueInput
  }


  /**
   * OrganizationMember updateMany
   */
  export type OrganizationMemberUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update OrganizationMembers.
     */
    data: XOR<OrganizationMemberUpdateManyMutationInput, OrganizationMemberUncheckedUpdateManyInput>
    /**
     * Filter which OrganizationMembers to update
     */
    where?: OrganizationMemberWhereInput
  }


  /**
   * OrganizationMember upsert
   */
  export type OrganizationMemberUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationMember
     */
    select?: OrganizationMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationMemberInclude<ExtArgs> | null
    /**
     * The filter to search for the OrganizationMember to update in case it exists.
     */
    where: OrganizationMemberWhereUniqueInput
    /**
     * In case the OrganizationMember found by the `where` argument doesn't exist, create a new OrganizationMember with this data.
     */
    create: XOR<OrganizationMemberCreateInput, OrganizationMemberUncheckedCreateInput>
    /**
     * In case the OrganizationMember was found with the provided `where` argument, update it with this data.
     */
    update: XOR<OrganizationMemberUpdateInput, OrganizationMemberUncheckedUpdateInput>
  }


  /**
   * OrganizationMember delete
   */
  export type OrganizationMemberDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationMember
     */
    select?: OrganizationMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationMemberInclude<ExtArgs> | null
    /**
     * Filter which OrganizationMember to delete.
     */
    where: OrganizationMemberWhereUniqueInput
  }


  /**
   * OrganizationMember deleteMany
   */
  export type OrganizationMemberDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which OrganizationMembers to delete
     */
    where?: OrganizationMemberWhereInput
  }


  /**
   * OrganizationMember without action
   */
  export type OrganizationMemberDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationMember
     */
    select?: OrganizationMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationMemberInclude<ExtArgs> | null
  }



  /**
   * Model OrganizationInviteToken
   */

  export type AggregateOrganizationInviteToken = {
    _count: OrganizationInviteTokenCountAggregateOutputType | null
    _min: OrganizationInviteTokenMinAggregateOutputType | null
    _max: OrganizationInviteTokenMaxAggregateOutputType | null
  }

  export type OrganizationInviteTokenMinAggregateOutputType = {
    id: string | null
    organizationId: string | null
    token: string | null
    createdByUserId: string | null
    expiresAt: Date | null
    usedAt: Date | null
    usedByUserId: string | null
    createdAt: Date | null
  }

  export type OrganizationInviteTokenMaxAggregateOutputType = {
    id: string | null
    organizationId: string | null
    token: string | null
    createdByUserId: string | null
    expiresAt: Date | null
    usedAt: Date | null
    usedByUserId: string | null
    createdAt: Date | null
  }

  export type OrganizationInviteTokenCountAggregateOutputType = {
    id: number
    organizationId: number
    token: number
    createdByUserId: number
    expiresAt: number
    usedAt: number
    usedByUserId: number
    createdAt: number
    _all: number
  }


  export type OrganizationInviteTokenMinAggregateInputType = {
    id?: true
    organizationId?: true
    token?: true
    createdByUserId?: true
    expiresAt?: true
    usedAt?: true
    usedByUserId?: true
    createdAt?: true
  }

  export type OrganizationInviteTokenMaxAggregateInputType = {
    id?: true
    organizationId?: true
    token?: true
    createdByUserId?: true
    expiresAt?: true
    usedAt?: true
    usedByUserId?: true
    createdAt?: true
  }

  export type OrganizationInviteTokenCountAggregateInputType = {
    id?: true
    organizationId?: true
    token?: true
    createdByUserId?: true
    expiresAt?: true
    usedAt?: true
    usedByUserId?: true
    createdAt?: true
    _all?: true
  }

  export type OrganizationInviteTokenAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which OrganizationInviteToken to aggregate.
     */
    where?: OrganizationInviteTokenWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OrganizationInviteTokens to fetch.
     */
    orderBy?: OrganizationInviteTokenOrderByWithRelationInput | OrganizationInviteTokenOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: OrganizationInviteTokenWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OrganizationInviteTokens from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OrganizationInviteTokens.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned OrganizationInviteTokens
    **/
    _count?: true | OrganizationInviteTokenCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: OrganizationInviteTokenMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: OrganizationInviteTokenMaxAggregateInputType
  }

  export type GetOrganizationInviteTokenAggregateType<T extends OrganizationInviteTokenAggregateArgs> = {
        [P in keyof T & keyof AggregateOrganizationInviteToken]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateOrganizationInviteToken[P]>
      : GetScalarType<T[P], AggregateOrganizationInviteToken[P]>
  }




  export type OrganizationInviteTokenGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: OrganizationInviteTokenWhereInput
    orderBy?: OrganizationInviteTokenOrderByWithAggregationInput | OrganizationInviteTokenOrderByWithAggregationInput[]
    by: OrganizationInviteTokenScalarFieldEnum[] | OrganizationInviteTokenScalarFieldEnum
    having?: OrganizationInviteTokenScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: OrganizationInviteTokenCountAggregateInputType | true
    _min?: OrganizationInviteTokenMinAggregateInputType
    _max?: OrganizationInviteTokenMaxAggregateInputType
  }

  export type OrganizationInviteTokenGroupByOutputType = {
    id: string
    organizationId: string
    token: string
    createdByUserId: string
    expiresAt: Date
    usedAt: Date | null
    usedByUserId: string | null
    createdAt: Date
    _count: OrganizationInviteTokenCountAggregateOutputType | null
    _min: OrganizationInviteTokenMinAggregateOutputType | null
    _max: OrganizationInviteTokenMaxAggregateOutputType | null
  }

  type GetOrganizationInviteTokenGroupByPayload<T extends OrganizationInviteTokenGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<OrganizationInviteTokenGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof OrganizationInviteTokenGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], OrganizationInviteTokenGroupByOutputType[P]>
            : GetScalarType<T[P], OrganizationInviteTokenGroupByOutputType[P]>
        }
      >
    >


  export type OrganizationInviteTokenSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    token?: boolean
    createdByUserId?: boolean
    expiresAt?: boolean
    usedAt?: boolean
    usedByUserId?: boolean
    createdAt?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["organizationInviteToken"]>

  export type OrganizationInviteTokenSelectScalar = {
    id?: boolean
    organizationId?: boolean
    token?: boolean
    createdByUserId?: boolean
    expiresAt?: boolean
    usedAt?: boolean
    usedByUserId?: boolean
    createdAt?: boolean
  }

  export type OrganizationInviteTokenInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
  }


  export type $OrganizationInviteTokenPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "OrganizationInviteToken"
    objects: {
      organization: Prisma.$OrganizationPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      organizationId: string
      token: string
      createdByUserId: string
      expiresAt: Date
      usedAt: Date | null
      usedByUserId: string | null
      createdAt: Date
    }, ExtArgs["result"]["organizationInviteToken"]>
    composites: {}
  }


  type OrganizationInviteTokenGetPayload<S extends boolean | null | undefined | OrganizationInviteTokenDefaultArgs> = $Result.GetResult<Prisma.$OrganizationInviteTokenPayload, S>

  type OrganizationInviteTokenCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<OrganizationInviteTokenFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: OrganizationInviteTokenCountAggregateInputType | true
    }

  export interface OrganizationInviteTokenDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['OrganizationInviteToken'], meta: { name: 'OrganizationInviteToken' } }
    /**
     * Find zero or one OrganizationInviteToken that matches the filter.
     * @param {OrganizationInviteTokenFindUniqueArgs} args - Arguments to find a OrganizationInviteToken
     * @example
     * // Get one OrganizationInviteToken
     * const organizationInviteToken = await prisma.organizationInviteToken.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends OrganizationInviteTokenFindUniqueArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationInviteTokenFindUniqueArgs<ExtArgs>>
    ): Prisma__OrganizationInviteTokenClient<$Result.GetResult<Prisma.$OrganizationInviteTokenPayload<ExtArgs>, T, 'findUnique'> | null, null, ExtArgs>

    /**
     * Find one OrganizationInviteToken that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {OrganizationInviteTokenFindUniqueOrThrowArgs} args - Arguments to find a OrganizationInviteToken
     * @example
     * // Get one OrganizationInviteToken
     * const organizationInviteToken = await prisma.organizationInviteToken.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends OrganizationInviteTokenFindUniqueOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationInviteTokenFindUniqueOrThrowArgs<ExtArgs>>
    ): Prisma__OrganizationInviteTokenClient<$Result.GetResult<Prisma.$OrganizationInviteTokenPayload<ExtArgs>, T, 'findUniqueOrThrow'>, never, ExtArgs>

    /**
     * Find the first OrganizationInviteToken that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationInviteTokenFindFirstArgs} args - Arguments to find a OrganizationInviteToken
     * @example
     * // Get one OrganizationInviteToken
     * const organizationInviteToken = await prisma.organizationInviteToken.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends OrganizationInviteTokenFindFirstArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationInviteTokenFindFirstArgs<ExtArgs>>
    ): Prisma__OrganizationInviteTokenClient<$Result.GetResult<Prisma.$OrganizationInviteTokenPayload<ExtArgs>, T, 'findFirst'> | null, null, ExtArgs>

    /**
     * Find the first OrganizationInviteToken that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationInviteTokenFindFirstOrThrowArgs} args - Arguments to find a OrganizationInviteToken
     * @example
     * // Get one OrganizationInviteToken
     * const organizationInviteToken = await prisma.organizationInviteToken.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends OrganizationInviteTokenFindFirstOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationInviteTokenFindFirstOrThrowArgs<ExtArgs>>
    ): Prisma__OrganizationInviteTokenClient<$Result.GetResult<Prisma.$OrganizationInviteTokenPayload<ExtArgs>, T, 'findFirstOrThrow'>, never, ExtArgs>

    /**
     * Find zero or more OrganizationInviteTokens that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationInviteTokenFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all OrganizationInviteTokens
     * const organizationInviteTokens = await prisma.organizationInviteToken.findMany()
     * 
     * // Get first 10 OrganizationInviteTokens
     * const organizationInviteTokens = await prisma.organizationInviteToken.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const organizationInviteTokenWithIdOnly = await prisma.organizationInviteToken.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends OrganizationInviteTokenFindManyArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationInviteTokenFindManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<$Result.GetResult<Prisma.$OrganizationInviteTokenPayload<ExtArgs>, T, 'findMany'>>

    /**
     * Create a OrganizationInviteToken.
     * @param {OrganizationInviteTokenCreateArgs} args - Arguments to create a OrganizationInviteToken.
     * @example
     * // Create one OrganizationInviteToken
     * const OrganizationInviteToken = await prisma.organizationInviteToken.create({
     *   data: {
     *     // ... data to create a OrganizationInviteToken
     *   }
     * })
     * 
    **/
    create<T extends OrganizationInviteTokenCreateArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationInviteTokenCreateArgs<ExtArgs>>
    ): Prisma__OrganizationInviteTokenClient<$Result.GetResult<Prisma.$OrganizationInviteTokenPayload<ExtArgs>, T, 'create'>, never, ExtArgs>

    /**
     * Create many OrganizationInviteTokens.
     *     @param {OrganizationInviteTokenCreateManyArgs} args - Arguments to create many OrganizationInviteTokens.
     *     @example
     *     // Create many OrganizationInviteTokens
     *     const organizationInviteToken = await prisma.organizationInviteToken.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends OrganizationInviteTokenCreateManyArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationInviteTokenCreateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a OrganizationInviteToken.
     * @param {OrganizationInviteTokenDeleteArgs} args - Arguments to delete one OrganizationInviteToken.
     * @example
     * // Delete one OrganizationInviteToken
     * const OrganizationInviteToken = await prisma.organizationInviteToken.delete({
     *   where: {
     *     // ... filter to delete one OrganizationInviteToken
     *   }
     * })
     * 
    **/
    delete<T extends OrganizationInviteTokenDeleteArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationInviteTokenDeleteArgs<ExtArgs>>
    ): Prisma__OrganizationInviteTokenClient<$Result.GetResult<Prisma.$OrganizationInviteTokenPayload<ExtArgs>, T, 'delete'>, never, ExtArgs>

    /**
     * Update one OrganizationInviteToken.
     * @param {OrganizationInviteTokenUpdateArgs} args - Arguments to update one OrganizationInviteToken.
     * @example
     * // Update one OrganizationInviteToken
     * const organizationInviteToken = await prisma.organizationInviteToken.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends OrganizationInviteTokenUpdateArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationInviteTokenUpdateArgs<ExtArgs>>
    ): Prisma__OrganizationInviteTokenClient<$Result.GetResult<Prisma.$OrganizationInviteTokenPayload<ExtArgs>, T, 'update'>, never, ExtArgs>

    /**
     * Delete zero or more OrganizationInviteTokens.
     * @param {OrganizationInviteTokenDeleteManyArgs} args - Arguments to filter OrganizationInviteTokens to delete.
     * @example
     * // Delete a few OrganizationInviteTokens
     * const { count } = await prisma.organizationInviteToken.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends OrganizationInviteTokenDeleteManyArgs<ExtArgs>>(
      args?: SelectSubset<T, OrganizationInviteTokenDeleteManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more OrganizationInviteTokens.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationInviteTokenUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many OrganizationInviteTokens
     * const organizationInviteToken = await prisma.organizationInviteToken.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends OrganizationInviteTokenUpdateManyArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationInviteTokenUpdateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one OrganizationInviteToken.
     * @param {OrganizationInviteTokenUpsertArgs} args - Arguments to update or create a OrganizationInviteToken.
     * @example
     * // Update or create a OrganizationInviteToken
     * const organizationInviteToken = await prisma.organizationInviteToken.upsert({
     *   create: {
     *     // ... data to create a OrganizationInviteToken
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the OrganizationInviteToken we want to update
     *   }
     * })
    **/
    upsert<T extends OrganizationInviteTokenUpsertArgs<ExtArgs>>(
      args: SelectSubset<T, OrganizationInviteTokenUpsertArgs<ExtArgs>>
    ): Prisma__OrganizationInviteTokenClient<$Result.GetResult<Prisma.$OrganizationInviteTokenPayload<ExtArgs>, T, 'upsert'>, never, ExtArgs>

    /**
     * Count the number of OrganizationInviteTokens.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationInviteTokenCountArgs} args - Arguments to filter OrganizationInviteTokens to count.
     * @example
     * // Count the number of OrganizationInviteTokens
     * const count = await prisma.organizationInviteToken.count({
     *   where: {
     *     // ... the filter for the OrganizationInviteTokens we want to count
     *   }
     * })
    **/
    count<T extends OrganizationInviteTokenCountArgs>(
      args?: Subset<T, OrganizationInviteTokenCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], OrganizationInviteTokenCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a OrganizationInviteToken.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationInviteTokenAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends OrganizationInviteTokenAggregateArgs>(args: Subset<T, OrganizationInviteTokenAggregateArgs>): Prisma.PrismaPromise<GetOrganizationInviteTokenAggregateType<T>>

    /**
     * Group by OrganizationInviteToken.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {OrganizationInviteTokenGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends OrganizationInviteTokenGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: OrganizationInviteTokenGroupByArgs['orderBy'] }
        : { orderBy?: OrganizationInviteTokenGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, OrganizationInviteTokenGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetOrganizationInviteTokenGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the OrganizationInviteToken model
   */
  readonly fields: OrganizationInviteTokenFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for OrganizationInviteToken.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__OrganizationInviteTokenClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: 'PrismaPromise';

    organization<T extends OrganizationDefaultArgs<ExtArgs> = {}>(args?: Subset<T, OrganizationDefaultArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, 'findUniqueOrThrow'> | Null, Null, ExtArgs>;

    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>;
  }



  /**
   * Fields of the OrganizationInviteToken model
   */ 
  interface OrganizationInviteTokenFieldRefs {
    readonly id: FieldRef<"OrganizationInviteToken", 'String'>
    readonly organizationId: FieldRef<"OrganizationInviteToken", 'String'>
    readonly token: FieldRef<"OrganizationInviteToken", 'String'>
    readonly createdByUserId: FieldRef<"OrganizationInviteToken", 'String'>
    readonly expiresAt: FieldRef<"OrganizationInviteToken", 'DateTime'>
    readonly usedAt: FieldRef<"OrganizationInviteToken", 'DateTime'>
    readonly usedByUserId: FieldRef<"OrganizationInviteToken", 'String'>
    readonly createdAt: FieldRef<"OrganizationInviteToken", 'DateTime'>
  }
    

  // Custom InputTypes

  /**
   * OrganizationInviteToken findUnique
   */
  export type OrganizationInviteTokenFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationInviteToken
     */
    select?: OrganizationInviteTokenSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInviteTokenInclude<ExtArgs> | null
    /**
     * Filter, which OrganizationInviteToken to fetch.
     */
    where: OrganizationInviteTokenWhereUniqueInput
  }


  /**
   * OrganizationInviteToken findUniqueOrThrow
   */
  export type OrganizationInviteTokenFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationInviteToken
     */
    select?: OrganizationInviteTokenSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInviteTokenInclude<ExtArgs> | null
    /**
     * Filter, which OrganizationInviteToken to fetch.
     */
    where: OrganizationInviteTokenWhereUniqueInput
  }


  /**
   * OrganizationInviteToken findFirst
   */
  export type OrganizationInviteTokenFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationInviteToken
     */
    select?: OrganizationInviteTokenSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInviteTokenInclude<ExtArgs> | null
    /**
     * Filter, which OrganizationInviteToken to fetch.
     */
    where?: OrganizationInviteTokenWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OrganizationInviteTokens to fetch.
     */
    orderBy?: OrganizationInviteTokenOrderByWithRelationInput | OrganizationInviteTokenOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for OrganizationInviteTokens.
     */
    cursor?: OrganizationInviteTokenWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OrganizationInviteTokens from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OrganizationInviteTokens.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of OrganizationInviteTokens.
     */
    distinct?: OrganizationInviteTokenScalarFieldEnum | OrganizationInviteTokenScalarFieldEnum[]
  }


  /**
   * OrganizationInviteToken findFirstOrThrow
   */
  export type OrganizationInviteTokenFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationInviteToken
     */
    select?: OrganizationInviteTokenSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInviteTokenInclude<ExtArgs> | null
    /**
     * Filter, which OrganizationInviteToken to fetch.
     */
    where?: OrganizationInviteTokenWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OrganizationInviteTokens to fetch.
     */
    orderBy?: OrganizationInviteTokenOrderByWithRelationInput | OrganizationInviteTokenOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for OrganizationInviteTokens.
     */
    cursor?: OrganizationInviteTokenWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OrganizationInviteTokens from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OrganizationInviteTokens.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of OrganizationInviteTokens.
     */
    distinct?: OrganizationInviteTokenScalarFieldEnum | OrganizationInviteTokenScalarFieldEnum[]
  }


  /**
   * OrganizationInviteToken findMany
   */
  export type OrganizationInviteTokenFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationInviteToken
     */
    select?: OrganizationInviteTokenSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInviteTokenInclude<ExtArgs> | null
    /**
     * Filter, which OrganizationInviteTokens to fetch.
     */
    where?: OrganizationInviteTokenWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of OrganizationInviteTokens to fetch.
     */
    orderBy?: OrganizationInviteTokenOrderByWithRelationInput | OrganizationInviteTokenOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing OrganizationInviteTokens.
     */
    cursor?: OrganizationInviteTokenWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` OrganizationInviteTokens from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` OrganizationInviteTokens.
     */
    skip?: number
    distinct?: OrganizationInviteTokenScalarFieldEnum | OrganizationInviteTokenScalarFieldEnum[]
  }


  /**
   * OrganizationInviteToken create
   */
  export type OrganizationInviteTokenCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationInviteToken
     */
    select?: OrganizationInviteTokenSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInviteTokenInclude<ExtArgs> | null
    /**
     * The data needed to create a OrganizationInviteToken.
     */
    data: XOR<OrganizationInviteTokenCreateInput, OrganizationInviteTokenUncheckedCreateInput>
  }


  /**
   * OrganizationInviteToken createMany
   */
  export type OrganizationInviteTokenCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many OrganizationInviteTokens.
     */
    data: OrganizationInviteTokenCreateManyInput | OrganizationInviteTokenCreateManyInput[]
    skipDuplicates?: boolean
  }


  /**
   * OrganizationInviteToken update
   */
  export type OrganizationInviteTokenUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationInviteToken
     */
    select?: OrganizationInviteTokenSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInviteTokenInclude<ExtArgs> | null
    /**
     * The data needed to update a OrganizationInviteToken.
     */
    data: XOR<OrganizationInviteTokenUpdateInput, OrganizationInviteTokenUncheckedUpdateInput>
    /**
     * Choose, which OrganizationInviteToken to update.
     */
    where: OrganizationInviteTokenWhereUniqueInput
  }


  /**
   * OrganizationInviteToken updateMany
   */
  export type OrganizationInviteTokenUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update OrganizationInviteTokens.
     */
    data: XOR<OrganizationInviteTokenUpdateManyMutationInput, OrganizationInviteTokenUncheckedUpdateManyInput>
    /**
     * Filter which OrganizationInviteTokens to update
     */
    where?: OrganizationInviteTokenWhereInput
  }


  /**
   * OrganizationInviteToken upsert
   */
  export type OrganizationInviteTokenUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationInviteToken
     */
    select?: OrganizationInviteTokenSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInviteTokenInclude<ExtArgs> | null
    /**
     * The filter to search for the OrganizationInviteToken to update in case it exists.
     */
    where: OrganizationInviteTokenWhereUniqueInput
    /**
     * In case the OrganizationInviteToken found by the `where` argument doesn't exist, create a new OrganizationInviteToken with this data.
     */
    create: XOR<OrganizationInviteTokenCreateInput, OrganizationInviteTokenUncheckedCreateInput>
    /**
     * In case the OrganizationInviteToken was found with the provided `where` argument, update it with this data.
     */
    update: XOR<OrganizationInviteTokenUpdateInput, OrganizationInviteTokenUncheckedUpdateInput>
  }


  /**
   * OrganizationInviteToken delete
   */
  export type OrganizationInviteTokenDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationInviteToken
     */
    select?: OrganizationInviteTokenSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInviteTokenInclude<ExtArgs> | null
    /**
     * Filter which OrganizationInviteToken to delete.
     */
    where: OrganizationInviteTokenWhereUniqueInput
  }


  /**
   * OrganizationInviteToken deleteMany
   */
  export type OrganizationInviteTokenDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which OrganizationInviteTokens to delete
     */
    where?: OrganizationInviteTokenWhereInput
  }


  /**
   * OrganizationInviteToken without action
   */
  export type OrganizationInviteTokenDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the OrganizationInviteToken
     */
    select?: OrganizationInviteTokenSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: OrganizationInviteTokenInclude<ExtArgs> | null
  }



  /**
   * Model Team
   */

  export type AggregateTeam = {
    _count: TeamCountAggregateOutputType | null
    _min: TeamMinAggregateOutputType | null
    _max: TeamMaxAggregateOutputType | null
  }

  export type TeamMinAggregateOutputType = {
    id: string | null
    organizationId: string | null
    name: string | null
    description: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TeamMaxAggregateOutputType = {
    id: string | null
    organizationId: string | null
    name: string | null
    description: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TeamCountAggregateOutputType = {
    id: number
    organizationId: number
    name: number
    description: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type TeamMinAggregateInputType = {
    id?: true
    organizationId?: true
    name?: true
    description?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TeamMaxAggregateInputType = {
    id?: true
    organizationId?: true
    name?: true
    description?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TeamCountAggregateInputType = {
    id?: true
    organizationId?: true
    name?: true
    description?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type TeamAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Team to aggregate.
     */
    where?: TeamWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Teams to fetch.
     */
    orderBy?: TeamOrderByWithRelationInput | TeamOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TeamWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Teams from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Teams.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Teams
    **/
    _count?: true | TeamCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TeamMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TeamMaxAggregateInputType
  }

  export type GetTeamAggregateType<T extends TeamAggregateArgs> = {
        [P in keyof T & keyof AggregateTeam]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTeam[P]>
      : GetScalarType<T[P], AggregateTeam[P]>
  }




  export type TeamGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TeamWhereInput
    orderBy?: TeamOrderByWithAggregationInput | TeamOrderByWithAggregationInput[]
    by: TeamScalarFieldEnum[] | TeamScalarFieldEnum
    having?: TeamScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TeamCountAggregateInputType | true
    _min?: TeamMinAggregateInputType
    _max?: TeamMaxAggregateInputType
  }

  export type TeamGroupByOutputType = {
    id: string
    organizationId: string
    name: string
    description: string | null
    createdAt: Date
    updatedAt: Date
    _count: TeamCountAggregateOutputType | null
    _min: TeamMinAggregateOutputType | null
    _max: TeamMaxAggregateOutputType | null
  }

  type GetTeamGroupByPayload<T extends TeamGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TeamGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TeamGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TeamGroupByOutputType[P]>
            : GetScalarType<T[P], TeamGroupByOutputType[P]>
        }
      >
    >


  export type TeamSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    organizationId?: boolean
    name?: boolean
    description?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    members?: boolean | Team$membersArgs<ExtArgs>
    projects?: boolean | Team$projectsArgs<ExtArgs>
    _count?: boolean | TeamCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["team"]>

  export type TeamSelectScalar = {
    id?: boolean
    organizationId?: boolean
    name?: boolean
    description?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type TeamInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    organization?: boolean | OrganizationDefaultArgs<ExtArgs>
    members?: boolean | Team$membersArgs<ExtArgs>
    projects?: boolean | Team$projectsArgs<ExtArgs>
    _count?: boolean | TeamCountOutputTypeDefaultArgs<ExtArgs>
  }


  export type $TeamPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Team"
    objects: {
      organization: Prisma.$OrganizationPayload<ExtArgs>
      members: Prisma.$TeamMemberPayload<ExtArgs>[]
      projects: Prisma.$ProjectPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      organizationId: string
      name: string
      description: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["team"]>
    composites: {}
  }


  type TeamGetPayload<S extends boolean | null | undefined | TeamDefaultArgs> = $Result.GetResult<Prisma.$TeamPayload, S>

  type TeamCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<TeamFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: TeamCountAggregateInputType | true
    }

  export interface TeamDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Team'], meta: { name: 'Team' } }
    /**
     * Find zero or one Team that matches the filter.
     * @param {TeamFindUniqueArgs} args - Arguments to find a Team
     * @example
     * // Get one Team
     * const team = await prisma.team.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends TeamFindUniqueArgs<ExtArgs>>(
      args: SelectSubset<T, TeamFindUniqueArgs<ExtArgs>>
    ): Prisma__TeamClient<$Result.GetResult<Prisma.$TeamPayload<ExtArgs>, T, 'findUnique'> | null, null, ExtArgs>

    /**
     * Find one Team that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {TeamFindUniqueOrThrowArgs} args - Arguments to find a Team
     * @example
     * // Get one Team
     * const team = await prisma.team.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends TeamFindUniqueOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, TeamFindUniqueOrThrowArgs<ExtArgs>>
    ): Prisma__TeamClient<$Result.GetResult<Prisma.$TeamPayload<ExtArgs>, T, 'findUniqueOrThrow'>, never, ExtArgs>

    /**
     * Find the first Team that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TeamFindFirstArgs} args - Arguments to find a Team
     * @example
     * // Get one Team
     * const team = await prisma.team.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends TeamFindFirstArgs<ExtArgs>>(
      args?: SelectSubset<T, TeamFindFirstArgs<ExtArgs>>
    ): Prisma__TeamClient<$Result.GetResult<Prisma.$TeamPayload<ExtArgs>, T, 'findFirst'> | null, null, ExtArgs>

    /**
     * Find the first Team that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TeamFindFirstOrThrowArgs} args - Arguments to find a Team
     * @example
     * // Get one Team
     * const team = await prisma.team.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends TeamFindFirstOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, TeamFindFirstOrThrowArgs<ExtArgs>>
    ): Prisma__TeamClient<$Result.GetResult<Prisma.$TeamPayload<ExtArgs>, T, 'findFirstOrThrow'>, never, ExtArgs>

    /**
     * Find zero or more Teams that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TeamFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Teams
     * const teams = await prisma.team.findMany()
     * 
     * // Get first 10 Teams
     * const teams = await prisma.team.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const teamWithIdOnly = await prisma.team.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends TeamFindManyArgs<ExtArgs>>(
      args?: SelectSubset<T, TeamFindManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TeamPayload<ExtArgs>, T, 'findMany'>>

    /**
     * Create a Team.
     * @param {TeamCreateArgs} args - Arguments to create a Team.
     * @example
     * // Create one Team
     * const Team = await prisma.team.create({
     *   data: {
     *     // ... data to create a Team
     *   }
     * })
     * 
    **/
    create<T extends TeamCreateArgs<ExtArgs>>(
      args: SelectSubset<T, TeamCreateArgs<ExtArgs>>
    ): Prisma__TeamClient<$Result.GetResult<Prisma.$TeamPayload<ExtArgs>, T, 'create'>, never, ExtArgs>

    /**
     * Create many Teams.
     *     @param {TeamCreateManyArgs} args - Arguments to create many Teams.
     *     @example
     *     // Create many Teams
     *     const team = await prisma.team.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends TeamCreateManyArgs<ExtArgs>>(
      args?: SelectSubset<T, TeamCreateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a Team.
     * @param {TeamDeleteArgs} args - Arguments to delete one Team.
     * @example
     * // Delete one Team
     * const Team = await prisma.team.delete({
     *   where: {
     *     // ... filter to delete one Team
     *   }
     * })
     * 
    **/
    delete<T extends TeamDeleteArgs<ExtArgs>>(
      args: SelectSubset<T, TeamDeleteArgs<ExtArgs>>
    ): Prisma__TeamClient<$Result.GetResult<Prisma.$TeamPayload<ExtArgs>, T, 'delete'>, never, ExtArgs>

    /**
     * Update one Team.
     * @param {TeamUpdateArgs} args - Arguments to update one Team.
     * @example
     * // Update one Team
     * const team = await prisma.team.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends TeamUpdateArgs<ExtArgs>>(
      args: SelectSubset<T, TeamUpdateArgs<ExtArgs>>
    ): Prisma__TeamClient<$Result.GetResult<Prisma.$TeamPayload<ExtArgs>, T, 'update'>, never, ExtArgs>

    /**
     * Delete zero or more Teams.
     * @param {TeamDeleteManyArgs} args - Arguments to filter Teams to delete.
     * @example
     * // Delete a few Teams
     * const { count } = await prisma.team.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends TeamDeleteManyArgs<ExtArgs>>(
      args?: SelectSubset<T, TeamDeleteManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Teams.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TeamUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Teams
     * const team = await prisma.team.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends TeamUpdateManyArgs<ExtArgs>>(
      args: SelectSubset<T, TeamUpdateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Team.
     * @param {TeamUpsertArgs} args - Arguments to update or create a Team.
     * @example
     * // Update or create a Team
     * const team = await prisma.team.upsert({
     *   create: {
     *     // ... data to create a Team
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Team we want to update
     *   }
     * })
    **/
    upsert<T extends TeamUpsertArgs<ExtArgs>>(
      args: SelectSubset<T, TeamUpsertArgs<ExtArgs>>
    ): Prisma__TeamClient<$Result.GetResult<Prisma.$TeamPayload<ExtArgs>, T, 'upsert'>, never, ExtArgs>

    /**
     * Count the number of Teams.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TeamCountArgs} args - Arguments to filter Teams to count.
     * @example
     * // Count the number of Teams
     * const count = await prisma.team.count({
     *   where: {
     *     // ... the filter for the Teams we want to count
     *   }
     * })
    **/
    count<T extends TeamCountArgs>(
      args?: Subset<T, TeamCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TeamCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Team.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TeamAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends TeamAggregateArgs>(args: Subset<T, TeamAggregateArgs>): Prisma.PrismaPromise<GetTeamAggregateType<T>>

    /**
     * Group by Team.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TeamGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends TeamGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TeamGroupByArgs['orderBy'] }
        : { orderBy?: TeamGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, TeamGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTeamGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Team model
   */
  readonly fields: TeamFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Team.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TeamClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: 'PrismaPromise';

    organization<T extends OrganizationDefaultArgs<ExtArgs> = {}>(args?: Subset<T, OrganizationDefaultArgs<ExtArgs>>): Prisma__OrganizationClient<$Result.GetResult<Prisma.$OrganizationPayload<ExtArgs>, T, 'findUniqueOrThrow'> | Null, Null, ExtArgs>;

    members<T extends Team$membersArgs<ExtArgs> = {}>(args?: Subset<T, Team$membersArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TeamMemberPayload<ExtArgs>, T, 'findMany'> | Null>;

    projects<T extends Team$projectsArgs<ExtArgs> = {}>(args?: Subset<T, Team$projectsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, 'findMany'> | Null>;

    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>;
  }



  /**
   * Fields of the Team model
   */ 
  interface TeamFieldRefs {
    readonly id: FieldRef<"Team", 'String'>
    readonly organizationId: FieldRef<"Team", 'String'>
    readonly name: FieldRef<"Team", 'String'>
    readonly description: FieldRef<"Team", 'String'>
    readonly createdAt: FieldRef<"Team", 'DateTime'>
    readonly updatedAt: FieldRef<"Team", 'DateTime'>
  }
    

  // Custom InputTypes

  /**
   * Team findUnique
   */
  export type TeamFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Team
     */
    select?: TeamSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamInclude<ExtArgs> | null
    /**
     * Filter, which Team to fetch.
     */
    where: TeamWhereUniqueInput
  }


  /**
   * Team findUniqueOrThrow
   */
  export type TeamFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Team
     */
    select?: TeamSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamInclude<ExtArgs> | null
    /**
     * Filter, which Team to fetch.
     */
    where: TeamWhereUniqueInput
  }


  /**
   * Team findFirst
   */
  export type TeamFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Team
     */
    select?: TeamSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamInclude<ExtArgs> | null
    /**
     * Filter, which Team to fetch.
     */
    where?: TeamWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Teams to fetch.
     */
    orderBy?: TeamOrderByWithRelationInput | TeamOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Teams.
     */
    cursor?: TeamWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Teams from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Teams.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Teams.
     */
    distinct?: TeamScalarFieldEnum | TeamScalarFieldEnum[]
  }


  /**
   * Team findFirstOrThrow
   */
  export type TeamFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Team
     */
    select?: TeamSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamInclude<ExtArgs> | null
    /**
     * Filter, which Team to fetch.
     */
    where?: TeamWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Teams to fetch.
     */
    orderBy?: TeamOrderByWithRelationInput | TeamOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Teams.
     */
    cursor?: TeamWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Teams from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Teams.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Teams.
     */
    distinct?: TeamScalarFieldEnum | TeamScalarFieldEnum[]
  }


  /**
   * Team findMany
   */
  export type TeamFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Team
     */
    select?: TeamSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamInclude<ExtArgs> | null
    /**
     * Filter, which Teams to fetch.
     */
    where?: TeamWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Teams to fetch.
     */
    orderBy?: TeamOrderByWithRelationInput | TeamOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Teams.
     */
    cursor?: TeamWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Teams from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Teams.
     */
    skip?: number
    distinct?: TeamScalarFieldEnum | TeamScalarFieldEnum[]
  }


  /**
   * Team create
   */
  export type TeamCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Team
     */
    select?: TeamSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamInclude<ExtArgs> | null
    /**
     * The data needed to create a Team.
     */
    data: XOR<TeamCreateInput, TeamUncheckedCreateInput>
  }


  /**
   * Team createMany
   */
  export type TeamCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Teams.
     */
    data: TeamCreateManyInput | TeamCreateManyInput[]
    skipDuplicates?: boolean
  }


  /**
   * Team update
   */
  export type TeamUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Team
     */
    select?: TeamSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamInclude<ExtArgs> | null
    /**
     * The data needed to update a Team.
     */
    data: XOR<TeamUpdateInput, TeamUncheckedUpdateInput>
    /**
     * Choose, which Team to update.
     */
    where: TeamWhereUniqueInput
  }


  /**
   * Team updateMany
   */
  export type TeamUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Teams.
     */
    data: XOR<TeamUpdateManyMutationInput, TeamUncheckedUpdateManyInput>
    /**
     * Filter which Teams to update
     */
    where?: TeamWhereInput
  }


  /**
   * Team upsert
   */
  export type TeamUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Team
     */
    select?: TeamSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamInclude<ExtArgs> | null
    /**
     * The filter to search for the Team to update in case it exists.
     */
    where: TeamWhereUniqueInput
    /**
     * In case the Team found by the `where` argument doesn't exist, create a new Team with this data.
     */
    create: XOR<TeamCreateInput, TeamUncheckedCreateInput>
    /**
     * In case the Team was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TeamUpdateInput, TeamUncheckedUpdateInput>
  }


  /**
   * Team delete
   */
  export type TeamDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Team
     */
    select?: TeamSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamInclude<ExtArgs> | null
    /**
     * Filter which Team to delete.
     */
    where: TeamWhereUniqueInput
  }


  /**
   * Team deleteMany
   */
  export type TeamDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Teams to delete
     */
    where?: TeamWhereInput
  }


  /**
   * Team.members
   */
  export type Team$membersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TeamMember
     */
    select?: TeamMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamMemberInclude<ExtArgs> | null
    where?: TeamMemberWhereInput
    orderBy?: TeamMemberOrderByWithRelationInput | TeamMemberOrderByWithRelationInput[]
    cursor?: TeamMemberWhereUniqueInput
    take?: number
    skip?: number
    distinct?: TeamMemberScalarFieldEnum | TeamMemberScalarFieldEnum[]
  }


  /**
   * Team.projects
   */
  export type Team$projectsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectInclude<ExtArgs> | null
    where?: ProjectWhereInput
    orderBy?: ProjectOrderByWithRelationInput | ProjectOrderByWithRelationInput[]
    cursor?: ProjectWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ProjectScalarFieldEnum | ProjectScalarFieldEnum[]
  }


  /**
   * Team without action
   */
  export type TeamDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Team
     */
    select?: TeamSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamInclude<ExtArgs> | null
  }



  /**
   * Model TeamMember
   */

  export type AggregateTeamMember = {
    _count: TeamMemberCountAggregateOutputType | null
    _min: TeamMemberMinAggregateOutputType | null
    _max: TeamMemberMaxAggregateOutputType | null
  }

  export type TeamMemberMinAggregateOutputType = {
    id: string | null
    teamId: string | null
    userId: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TeamMemberMaxAggregateOutputType = {
    id: string | null
    teamId: string | null
    userId: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TeamMemberCountAggregateOutputType = {
    id: number
    teamId: number
    userId: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type TeamMemberMinAggregateInputType = {
    id?: true
    teamId?: true
    userId?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TeamMemberMaxAggregateInputType = {
    id?: true
    teamId?: true
    userId?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TeamMemberCountAggregateInputType = {
    id?: true
    teamId?: true
    userId?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type TeamMemberAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TeamMember to aggregate.
     */
    where?: TeamMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TeamMembers to fetch.
     */
    orderBy?: TeamMemberOrderByWithRelationInput | TeamMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TeamMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TeamMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TeamMembers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned TeamMembers
    **/
    _count?: true | TeamMemberCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TeamMemberMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TeamMemberMaxAggregateInputType
  }

  export type GetTeamMemberAggregateType<T extends TeamMemberAggregateArgs> = {
        [P in keyof T & keyof AggregateTeamMember]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTeamMember[P]>
      : GetScalarType<T[P], AggregateTeamMember[P]>
  }




  export type TeamMemberGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TeamMemberWhereInput
    orderBy?: TeamMemberOrderByWithAggregationInput | TeamMemberOrderByWithAggregationInput[]
    by: TeamMemberScalarFieldEnum[] | TeamMemberScalarFieldEnum
    having?: TeamMemberScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TeamMemberCountAggregateInputType | true
    _min?: TeamMemberMinAggregateInputType
    _max?: TeamMemberMaxAggregateInputType
  }

  export type TeamMemberGroupByOutputType = {
    id: string
    teamId: string
    userId: string
    createdAt: Date
    updatedAt: Date
    _count: TeamMemberCountAggregateOutputType | null
    _min: TeamMemberMinAggregateOutputType | null
    _max: TeamMemberMaxAggregateOutputType | null
  }

  type GetTeamMemberGroupByPayload<T extends TeamMemberGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TeamMemberGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TeamMemberGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TeamMemberGroupByOutputType[P]>
            : GetScalarType<T[P], TeamMemberGroupByOutputType[P]>
        }
      >
    >


  export type TeamMemberSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    teamId?: boolean
    userId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    team?: boolean | TeamDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["teamMember"]>

  export type TeamMemberSelectScalar = {
    id?: boolean
    teamId?: boolean
    userId?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type TeamMemberInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    team?: boolean | TeamDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }


  export type $TeamMemberPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "TeamMember"
    objects: {
      team: Prisma.$TeamPayload<ExtArgs>
      user: Prisma.$UserPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      teamId: string
      userId: string
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["teamMember"]>
    composites: {}
  }


  type TeamMemberGetPayload<S extends boolean | null | undefined | TeamMemberDefaultArgs> = $Result.GetResult<Prisma.$TeamMemberPayload, S>

  type TeamMemberCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<TeamMemberFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: TeamMemberCountAggregateInputType | true
    }

  export interface TeamMemberDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['TeamMember'], meta: { name: 'TeamMember' } }
    /**
     * Find zero or one TeamMember that matches the filter.
     * @param {TeamMemberFindUniqueArgs} args - Arguments to find a TeamMember
     * @example
     * // Get one TeamMember
     * const teamMember = await prisma.teamMember.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends TeamMemberFindUniqueArgs<ExtArgs>>(
      args: SelectSubset<T, TeamMemberFindUniqueArgs<ExtArgs>>
    ): Prisma__TeamMemberClient<$Result.GetResult<Prisma.$TeamMemberPayload<ExtArgs>, T, 'findUnique'> | null, null, ExtArgs>

    /**
     * Find one TeamMember that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {TeamMemberFindUniqueOrThrowArgs} args - Arguments to find a TeamMember
     * @example
     * // Get one TeamMember
     * const teamMember = await prisma.teamMember.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends TeamMemberFindUniqueOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, TeamMemberFindUniqueOrThrowArgs<ExtArgs>>
    ): Prisma__TeamMemberClient<$Result.GetResult<Prisma.$TeamMemberPayload<ExtArgs>, T, 'findUniqueOrThrow'>, never, ExtArgs>

    /**
     * Find the first TeamMember that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TeamMemberFindFirstArgs} args - Arguments to find a TeamMember
     * @example
     * // Get one TeamMember
     * const teamMember = await prisma.teamMember.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends TeamMemberFindFirstArgs<ExtArgs>>(
      args?: SelectSubset<T, TeamMemberFindFirstArgs<ExtArgs>>
    ): Prisma__TeamMemberClient<$Result.GetResult<Prisma.$TeamMemberPayload<ExtArgs>, T, 'findFirst'> | null, null, ExtArgs>

    /**
     * Find the first TeamMember that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TeamMemberFindFirstOrThrowArgs} args - Arguments to find a TeamMember
     * @example
     * // Get one TeamMember
     * const teamMember = await prisma.teamMember.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends TeamMemberFindFirstOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, TeamMemberFindFirstOrThrowArgs<ExtArgs>>
    ): Prisma__TeamMemberClient<$Result.GetResult<Prisma.$TeamMemberPayload<ExtArgs>, T, 'findFirstOrThrow'>, never, ExtArgs>

    /**
     * Find zero or more TeamMembers that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TeamMemberFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all TeamMembers
     * const teamMembers = await prisma.teamMember.findMany()
     * 
     * // Get first 10 TeamMembers
     * const teamMembers = await prisma.teamMember.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const teamMemberWithIdOnly = await prisma.teamMember.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends TeamMemberFindManyArgs<ExtArgs>>(
      args?: SelectSubset<T, TeamMemberFindManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TeamMemberPayload<ExtArgs>, T, 'findMany'>>

    /**
     * Create a TeamMember.
     * @param {TeamMemberCreateArgs} args - Arguments to create a TeamMember.
     * @example
     * // Create one TeamMember
     * const TeamMember = await prisma.teamMember.create({
     *   data: {
     *     // ... data to create a TeamMember
     *   }
     * })
     * 
    **/
    create<T extends TeamMemberCreateArgs<ExtArgs>>(
      args: SelectSubset<T, TeamMemberCreateArgs<ExtArgs>>
    ): Prisma__TeamMemberClient<$Result.GetResult<Prisma.$TeamMemberPayload<ExtArgs>, T, 'create'>, never, ExtArgs>

    /**
     * Create many TeamMembers.
     *     @param {TeamMemberCreateManyArgs} args - Arguments to create many TeamMembers.
     *     @example
     *     // Create many TeamMembers
     *     const teamMember = await prisma.teamMember.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends TeamMemberCreateManyArgs<ExtArgs>>(
      args?: SelectSubset<T, TeamMemberCreateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a TeamMember.
     * @param {TeamMemberDeleteArgs} args - Arguments to delete one TeamMember.
     * @example
     * // Delete one TeamMember
     * const TeamMember = await prisma.teamMember.delete({
     *   where: {
     *     // ... filter to delete one TeamMember
     *   }
     * })
     * 
    **/
    delete<T extends TeamMemberDeleteArgs<ExtArgs>>(
      args: SelectSubset<T, TeamMemberDeleteArgs<ExtArgs>>
    ): Prisma__TeamMemberClient<$Result.GetResult<Prisma.$TeamMemberPayload<ExtArgs>, T, 'delete'>, never, ExtArgs>

    /**
     * Update one TeamMember.
     * @param {TeamMemberUpdateArgs} args - Arguments to update one TeamMember.
     * @example
     * // Update one TeamMember
     * const teamMember = await prisma.teamMember.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends TeamMemberUpdateArgs<ExtArgs>>(
      args: SelectSubset<T, TeamMemberUpdateArgs<ExtArgs>>
    ): Prisma__TeamMemberClient<$Result.GetResult<Prisma.$TeamMemberPayload<ExtArgs>, T, 'update'>, never, ExtArgs>

    /**
     * Delete zero or more TeamMembers.
     * @param {TeamMemberDeleteManyArgs} args - Arguments to filter TeamMembers to delete.
     * @example
     * // Delete a few TeamMembers
     * const { count } = await prisma.teamMember.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends TeamMemberDeleteManyArgs<ExtArgs>>(
      args?: SelectSubset<T, TeamMemberDeleteManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more TeamMembers.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TeamMemberUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many TeamMembers
     * const teamMember = await prisma.teamMember.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends TeamMemberUpdateManyArgs<ExtArgs>>(
      args: SelectSubset<T, TeamMemberUpdateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one TeamMember.
     * @param {TeamMemberUpsertArgs} args - Arguments to update or create a TeamMember.
     * @example
     * // Update or create a TeamMember
     * const teamMember = await prisma.teamMember.upsert({
     *   create: {
     *     // ... data to create a TeamMember
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the TeamMember we want to update
     *   }
     * })
    **/
    upsert<T extends TeamMemberUpsertArgs<ExtArgs>>(
      args: SelectSubset<T, TeamMemberUpsertArgs<ExtArgs>>
    ): Prisma__TeamMemberClient<$Result.GetResult<Prisma.$TeamMemberPayload<ExtArgs>, T, 'upsert'>, never, ExtArgs>

    /**
     * Count the number of TeamMembers.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TeamMemberCountArgs} args - Arguments to filter TeamMembers to count.
     * @example
     * // Count the number of TeamMembers
     * const count = await prisma.teamMember.count({
     *   where: {
     *     // ... the filter for the TeamMembers we want to count
     *   }
     * })
    **/
    count<T extends TeamMemberCountArgs>(
      args?: Subset<T, TeamMemberCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TeamMemberCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a TeamMember.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TeamMemberAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends TeamMemberAggregateArgs>(args: Subset<T, TeamMemberAggregateArgs>): Prisma.PrismaPromise<GetTeamMemberAggregateType<T>>

    /**
     * Group by TeamMember.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TeamMemberGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends TeamMemberGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TeamMemberGroupByArgs['orderBy'] }
        : { orderBy?: TeamMemberGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, TeamMemberGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTeamMemberGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the TeamMember model
   */
  readonly fields: TeamMemberFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for TeamMember.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TeamMemberClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: 'PrismaPromise';

    team<T extends TeamDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TeamDefaultArgs<ExtArgs>>): Prisma__TeamClient<$Result.GetResult<Prisma.$TeamPayload<ExtArgs>, T, 'findUniqueOrThrow'> | Null, Null, ExtArgs>;

    user<T extends UserDefaultArgs<ExtArgs> = {}>(args?: Subset<T, UserDefaultArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, 'findUniqueOrThrow'> | Null, Null, ExtArgs>;

    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>;
  }



  /**
   * Fields of the TeamMember model
   */ 
  interface TeamMemberFieldRefs {
    readonly id: FieldRef<"TeamMember", 'String'>
    readonly teamId: FieldRef<"TeamMember", 'String'>
    readonly userId: FieldRef<"TeamMember", 'String'>
    readonly createdAt: FieldRef<"TeamMember", 'DateTime'>
    readonly updatedAt: FieldRef<"TeamMember", 'DateTime'>
  }
    

  // Custom InputTypes

  /**
   * TeamMember findUnique
   */
  export type TeamMemberFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TeamMember
     */
    select?: TeamMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamMemberInclude<ExtArgs> | null
    /**
     * Filter, which TeamMember to fetch.
     */
    where: TeamMemberWhereUniqueInput
  }


  /**
   * TeamMember findUniqueOrThrow
   */
  export type TeamMemberFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TeamMember
     */
    select?: TeamMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamMemberInclude<ExtArgs> | null
    /**
     * Filter, which TeamMember to fetch.
     */
    where: TeamMemberWhereUniqueInput
  }


  /**
   * TeamMember findFirst
   */
  export type TeamMemberFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TeamMember
     */
    select?: TeamMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamMemberInclude<ExtArgs> | null
    /**
     * Filter, which TeamMember to fetch.
     */
    where?: TeamMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TeamMembers to fetch.
     */
    orderBy?: TeamMemberOrderByWithRelationInput | TeamMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TeamMembers.
     */
    cursor?: TeamMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TeamMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TeamMembers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TeamMembers.
     */
    distinct?: TeamMemberScalarFieldEnum | TeamMemberScalarFieldEnum[]
  }


  /**
   * TeamMember findFirstOrThrow
   */
  export type TeamMemberFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TeamMember
     */
    select?: TeamMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamMemberInclude<ExtArgs> | null
    /**
     * Filter, which TeamMember to fetch.
     */
    where?: TeamMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TeamMembers to fetch.
     */
    orderBy?: TeamMemberOrderByWithRelationInput | TeamMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for TeamMembers.
     */
    cursor?: TeamMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TeamMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TeamMembers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of TeamMembers.
     */
    distinct?: TeamMemberScalarFieldEnum | TeamMemberScalarFieldEnum[]
  }


  /**
   * TeamMember findMany
   */
  export type TeamMemberFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TeamMember
     */
    select?: TeamMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamMemberInclude<ExtArgs> | null
    /**
     * Filter, which TeamMembers to fetch.
     */
    where?: TeamMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of TeamMembers to fetch.
     */
    orderBy?: TeamMemberOrderByWithRelationInput | TeamMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing TeamMembers.
     */
    cursor?: TeamMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` TeamMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` TeamMembers.
     */
    skip?: number
    distinct?: TeamMemberScalarFieldEnum | TeamMemberScalarFieldEnum[]
  }


  /**
   * TeamMember create
   */
  export type TeamMemberCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TeamMember
     */
    select?: TeamMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamMemberInclude<ExtArgs> | null
    /**
     * The data needed to create a TeamMember.
     */
    data: XOR<TeamMemberCreateInput, TeamMemberUncheckedCreateInput>
  }


  /**
   * TeamMember createMany
   */
  export type TeamMemberCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many TeamMembers.
     */
    data: TeamMemberCreateManyInput | TeamMemberCreateManyInput[]
    skipDuplicates?: boolean
  }


  /**
   * TeamMember update
   */
  export type TeamMemberUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TeamMember
     */
    select?: TeamMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamMemberInclude<ExtArgs> | null
    /**
     * The data needed to update a TeamMember.
     */
    data: XOR<TeamMemberUpdateInput, TeamMemberUncheckedUpdateInput>
    /**
     * Choose, which TeamMember to update.
     */
    where: TeamMemberWhereUniqueInput
  }


  /**
   * TeamMember updateMany
   */
  export type TeamMemberUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update TeamMembers.
     */
    data: XOR<TeamMemberUpdateManyMutationInput, TeamMemberUncheckedUpdateManyInput>
    /**
     * Filter which TeamMembers to update
     */
    where?: TeamMemberWhereInput
  }


  /**
   * TeamMember upsert
   */
  export type TeamMemberUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TeamMember
     */
    select?: TeamMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamMemberInclude<ExtArgs> | null
    /**
     * The filter to search for the TeamMember to update in case it exists.
     */
    where: TeamMemberWhereUniqueInput
    /**
     * In case the TeamMember found by the `where` argument doesn't exist, create a new TeamMember with this data.
     */
    create: XOR<TeamMemberCreateInput, TeamMemberUncheckedCreateInput>
    /**
     * In case the TeamMember was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TeamMemberUpdateInput, TeamMemberUncheckedUpdateInput>
  }


  /**
   * TeamMember delete
   */
  export type TeamMemberDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TeamMember
     */
    select?: TeamMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamMemberInclude<ExtArgs> | null
    /**
     * Filter which TeamMember to delete.
     */
    where: TeamMemberWhereUniqueInput
  }


  /**
   * TeamMember deleteMany
   */
  export type TeamMemberDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which TeamMembers to delete
     */
    where?: TeamMemberWhereInput
  }


  /**
   * TeamMember without action
   */
  export type TeamMemberDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TeamMember
     */
    select?: TeamMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: TeamMemberInclude<ExtArgs> | null
  }



  /**
   * Model Project
   */

  export type AggregateProject = {
    _count: ProjectCountAggregateOutputType | null
    _min: ProjectMinAggregateOutputType | null
    _max: ProjectMaxAggregateOutputType | null
  }

  export type ProjectMinAggregateOutputType = {
    id: string | null
    teamId: string | null
    name: string | null
    description: string | null
    thumbnailUrl: string | null
    stateUrl: string | null
    isPublic: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ProjectMaxAggregateOutputType = {
    id: string | null
    teamId: string | null
    name: string | null
    description: string | null
    thumbnailUrl: string | null
    stateUrl: string | null
    isPublic: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type ProjectCountAggregateOutputType = {
    id: number
    teamId: number
    name: number
    description: number
    thumbnailUrl: number
    stateUrl: number
    isPublic: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type ProjectMinAggregateInputType = {
    id?: true
    teamId?: true
    name?: true
    description?: true
    thumbnailUrl?: true
    stateUrl?: true
    isPublic?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ProjectMaxAggregateInputType = {
    id?: true
    teamId?: true
    name?: true
    description?: true
    thumbnailUrl?: true
    stateUrl?: true
    isPublic?: true
    createdAt?: true
    updatedAt?: true
  }

  export type ProjectCountAggregateInputType = {
    id?: true
    teamId?: true
    name?: true
    description?: true
    thumbnailUrl?: true
    stateUrl?: true
    isPublic?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type ProjectAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Project to aggregate.
     */
    where?: ProjectWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Projects to fetch.
     */
    orderBy?: ProjectOrderByWithRelationInput | ProjectOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ProjectWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Projects from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Projects.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Projects
    **/
    _count?: true | ProjectCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ProjectMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ProjectMaxAggregateInputType
  }

  export type GetProjectAggregateType<T extends ProjectAggregateArgs> = {
        [P in keyof T & keyof AggregateProject]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateProject[P]>
      : GetScalarType<T[P], AggregateProject[P]>
  }




  export type ProjectGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ProjectWhereInput
    orderBy?: ProjectOrderByWithAggregationInput | ProjectOrderByWithAggregationInput[]
    by: ProjectScalarFieldEnum[] | ProjectScalarFieldEnum
    having?: ProjectScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ProjectCountAggregateInputType | true
    _min?: ProjectMinAggregateInputType
    _max?: ProjectMaxAggregateInputType
  }

  export type ProjectGroupByOutputType = {
    id: string
    teamId: string
    name: string
    description: string | null
    thumbnailUrl: string | null
    stateUrl: string | null
    isPublic: boolean
    createdAt: Date
    updatedAt: Date
    _count: ProjectCountAggregateOutputType | null
    _min: ProjectMinAggregateOutputType | null
    _max: ProjectMaxAggregateOutputType | null
  }

  type GetProjectGroupByPayload<T extends ProjectGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ProjectGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ProjectGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ProjectGroupByOutputType[P]>
            : GetScalarType<T[P], ProjectGroupByOutputType[P]>
        }
      >
    >


  export type ProjectSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    teamId?: boolean
    name?: boolean
    description?: boolean
    thumbnailUrl?: boolean
    stateUrl?: boolean
    isPublic?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    team?: boolean | TeamDefaultArgs<ExtArgs>
    members?: boolean | Project$membersArgs<ExtArgs>
    publishedAsset?: boolean | Project$publishedAssetArgs<ExtArgs>
    clonedFrom?: boolean | Project$clonedFromArgs<ExtArgs>
    _count?: boolean | ProjectCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["project"]>

  export type ProjectSelectScalar = {
    id?: boolean
    teamId?: boolean
    name?: boolean
    description?: boolean
    thumbnailUrl?: boolean
    stateUrl?: boolean
    isPublic?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type ProjectInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    team?: boolean | TeamDefaultArgs<ExtArgs>
    members?: boolean | Project$membersArgs<ExtArgs>
    publishedAsset?: boolean | Project$publishedAssetArgs<ExtArgs>
    clonedFrom?: boolean | Project$clonedFromArgs<ExtArgs>
    _count?: boolean | ProjectCountOutputTypeDefaultArgs<ExtArgs>
  }


  export type $ProjectPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Project"
    objects: {
      team: Prisma.$TeamPayload<ExtArgs>
      members: Prisma.$ProjectMemberPayload<ExtArgs>[]
      publishedAsset: Prisma.$MarketplaceAssetPayload<ExtArgs> | null
      clonedFrom: Prisma.$ProjectClonePayload<ExtArgs> | null
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      teamId: string
      name: string
      description: string | null
      thumbnailUrl: string | null
      stateUrl: string | null
      isPublic: boolean
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["project"]>
    composites: {}
  }


  type ProjectGetPayload<S extends boolean | null | undefined | ProjectDefaultArgs> = $Result.GetResult<Prisma.$ProjectPayload, S>

  type ProjectCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<ProjectFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: ProjectCountAggregateInputType | true
    }

  export interface ProjectDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Project'], meta: { name: 'Project' } }
    /**
     * Find zero or one Project that matches the filter.
     * @param {ProjectFindUniqueArgs} args - Arguments to find a Project
     * @example
     * // Get one Project
     * const project = await prisma.project.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends ProjectFindUniqueArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectFindUniqueArgs<ExtArgs>>
    ): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, 'findUnique'> | null, null, ExtArgs>

    /**
     * Find one Project that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {ProjectFindUniqueOrThrowArgs} args - Arguments to find a Project
     * @example
     * // Get one Project
     * const project = await prisma.project.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends ProjectFindUniqueOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectFindUniqueOrThrowArgs<ExtArgs>>
    ): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, 'findUniqueOrThrow'>, never, ExtArgs>

    /**
     * Find the first Project that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectFindFirstArgs} args - Arguments to find a Project
     * @example
     * // Get one Project
     * const project = await prisma.project.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends ProjectFindFirstArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectFindFirstArgs<ExtArgs>>
    ): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, 'findFirst'> | null, null, ExtArgs>

    /**
     * Find the first Project that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectFindFirstOrThrowArgs} args - Arguments to find a Project
     * @example
     * // Get one Project
     * const project = await prisma.project.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends ProjectFindFirstOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectFindFirstOrThrowArgs<ExtArgs>>
    ): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, 'findFirstOrThrow'>, never, ExtArgs>

    /**
     * Find zero or more Projects that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Projects
     * const projects = await prisma.project.findMany()
     * 
     * // Get first 10 Projects
     * const projects = await prisma.project.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const projectWithIdOnly = await prisma.project.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends ProjectFindManyArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectFindManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, 'findMany'>>

    /**
     * Create a Project.
     * @param {ProjectCreateArgs} args - Arguments to create a Project.
     * @example
     * // Create one Project
     * const Project = await prisma.project.create({
     *   data: {
     *     // ... data to create a Project
     *   }
     * })
     * 
    **/
    create<T extends ProjectCreateArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectCreateArgs<ExtArgs>>
    ): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, 'create'>, never, ExtArgs>

    /**
     * Create many Projects.
     *     @param {ProjectCreateManyArgs} args - Arguments to create many Projects.
     *     @example
     *     // Create many Projects
     *     const project = await prisma.project.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends ProjectCreateManyArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectCreateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a Project.
     * @param {ProjectDeleteArgs} args - Arguments to delete one Project.
     * @example
     * // Delete one Project
     * const Project = await prisma.project.delete({
     *   where: {
     *     // ... filter to delete one Project
     *   }
     * })
     * 
    **/
    delete<T extends ProjectDeleteArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectDeleteArgs<ExtArgs>>
    ): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, 'delete'>, never, ExtArgs>

    /**
     * Update one Project.
     * @param {ProjectUpdateArgs} args - Arguments to update one Project.
     * @example
     * // Update one Project
     * const project = await prisma.project.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends ProjectUpdateArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectUpdateArgs<ExtArgs>>
    ): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, 'update'>, never, ExtArgs>

    /**
     * Delete zero or more Projects.
     * @param {ProjectDeleteManyArgs} args - Arguments to filter Projects to delete.
     * @example
     * // Delete a few Projects
     * const { count } = await prisma.project.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends ProjectDeleteManyArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectDeleteManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Projects.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Projects
     * const project = await prisma.project.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends ProjectUpdateManyArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectUpdateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Project.
     * @param {ProjectUpsertArgs} args - Arguments to update or create a Project.
     * @example
     * // Update or create a Project
     * const project = await prisma.project.upsert({
     *   create: {
     *     // ... data to create a Project
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Project we want to update
     *   }
     * })
    **/
    upsert<T extends ProjectUpsertArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectUpsertArgs<ExtArgs>>
    ): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, 'upsert'>, never, ExtArgs>

    /**
     * Count the number of Projects.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectCountArgs} args - Arguments to filter Projects to count.
     * @example
     * // Count the number of Projects
     * const count = await prisma.project.count({
     *   where: {
     *     // ... the filter for the Projects we want to count
     *   }
     * })
    **/
    count<T extends ProjectCountArgs>(
      args?: Subset<T, ProjectCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ProjectCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Project.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends ProjectAggregateArgs>(args: Subset<T, ProjectAggregateArgs>): Prisma.PrismaPromise<GetProjectAggregateType<T>>

    /**
     * Group by Project.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends ProjectGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ProjectGroupByArgs['orderBy'] }
        : { orderBy?: ProjectGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, ProjectGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetProjectGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Project model
   */
  readonly fields: ProjectFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Project.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ProjectClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: 'PrismaPromise';

    team<T extends TeamDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TeamDefaultArgs<ExtArgs>>): Prisma__TeamClient<$Result.GetResult<Prisma.$TeamPayload<ExtArgs>, T, 'findUniqueOrThrow'> | Null, Null, ExtArgs>;

    members<T extends Project$membersArgs<ExtArgs> = {}>(args?: Subset<T, Project$membersArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ProjectMemberPayload<ExtArgs>, T, 'findMany'> | Null>;

    publishedAsset<T extends Project$publishedAssetArgs<ExtArgs> = {}>(args?: Subset<T, Project$publishedAssetArgs<ExtArgs>>): Prisma__MarketplaceAssetClient<$Result.GetResult<Prisma.$MarketplaceAssetPayload<ExtArgs>, T, 'findUniqueOrThrow'> | null, null, ExtArgs>;

    clonedFrom<T extends Project$clonedFromArgs<ExtArgs> = {}>(args?: Subset<T, Project$clonedFromArgs<ExtArgs>>): Prisma__ProjectCloneClient<$Result.GetResult<Prisma.$ProjectClonePayload<ExtArgs>, T, 'findUniqueOrThrow'> | null, null, ExtArgs>;

    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>;
  }



  /**
   * Fields of the Project model
   */ 
  interface ProjectFieldRefs {
    readonly id: FieldRef<"Project", 'String'>
    readonly teamId: FieldRef<"Project", 'String'>
    readonly name: FieldRef<"Project", 'String'>
    readonly description: FieldRef<"Project", 'String'>
    readonly thumbnailUrl: FieldRef<"Project", 'String'>
    readonly stateUrl: FieldRef<"Project", 'String'>
    readonly isPublic: FieldRef<"Project", 'Boolean'>
    readonly createdAt: FieldRef<"Project", 'DateTime'>
    readonly updatedAt: FieldRef<"Project", 'DateTime'>
  }
    

  // Custom InputTypes

  /**
   * Project findUnique
   */
  export type ProjectFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * Filter, which Project to fetch.
     */
    where: ProjectWhereUniqueInput
  }


  /**
   * Project findUniqueOrThrow
   */
  export type ProjectFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * Filter, which Project to fetch.
     */
    where: ProjectWhereUniqueInput
  }


  /**
   * Project findFirst
   */
  export type ProjectFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * Filter, which Project to fetch.
     */
    where?: ProjectWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Projects to fetch.
     */
    orderBy?: ProjectOrderByWithRelationInput | ProjectOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Projects.
     */
    cursor?: ProjectWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Projects from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Projects.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Projects.
     */
    distinct?: ProjectScalarFieldEnum | ProjectScalarFieldEnum[]
  }


  /**
   * Project findFirstOrThrow
   */
  export type ProjectFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * Filter, which Project to fetch.
     */
    where?: ProjectWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Projects to fetch.
     */
    orderBy?: ProjectOrderByWithRelationInput | ProjectOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Projects.
     */
    cursor?: ProjectWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Projects from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Projects.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Projects.
     */
    distinct?: ProjectScalarFieldEnum | ProjectScalarFieldEnum[]
  }


  /**
   * Project findMany
   */
  export type ProjectFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * Filter, which Projects to fetch.
     */
    where?: ProjectWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Projects to fetch.
     */
    orderBy?: ProjectOrderByWithRelationInput | ProjectOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Projects.
     */
    cursor?: ProjectWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Projects from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Projects.
     */
    skip?: number
    distinct?: ProjectScalarFieldEnum | ProjectScalarFieldEnum[]
  }


  /**
   * Project create
   */
  export type ProjectCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * The data needed to create a Project.
     */
    data: XOR<ProjectCreateInput, ProjectUncheckedCreateInput>
  }


  /**
   * Project createMany
   */
  export type ProjectCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Projects.
     */
    data: ProjectCreateManyInput | ProjectCreateManyInput[]
    skipDuplicates?: boolean
  }


  /**
   * Project update
   */
  export type ProjectUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * The data needed to update a Project.
     */
    data: XOR<ProjectUpdateInput, ProjectUncheckedUpdateInput>
    /**
     * Choose, which Project to update.
     */
    where: ProjectWhereUniqueInput
  }


  /**
   * Project updateMany
   */
  export type ProjectUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Projects.
     */
    data: XOR<ProjectUpdateManyMutationInput, ProjectUncheckedUpdateManyInput>
    /**
     * Filter which Projects to update
     */
    where?: ProjectWhereInput
  }


  /**
   * Project upsert
   */
  export type ProjectUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * The filter to search for the Project to update in case it exists.
     */
    where: ProjectWhereUniqueInput
    /**
     * In case the Project found by the `where` argument doesn't exist, create a new Project with this data.
     */
    create: XOR<ProjectCreateInput, ProjectUncheckedCreateInput>
    /**
     * In case the Project was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ProjectUpdateInput, ProjectUncheckedUpdateInput>
  }


  /**
   * Project delete
   */
  export type ProjectDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectInclude<ExtArgs> | null
    /**
     * Filter which Project to delete.
     */
    where: ProjectWhereUniqueInput
  }


  /**
   * Project deleteMany
   */
  export type ProjectDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Projects to delete
     */
    where?: ProjectWhereInput
  }


  /**
   * Project.members
   */
  export type Project$membersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectMember
     */
    select?: ProjectMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectMemberInclude<ExtArgs> | null
    where?: ProjectMemberWhereInput
    orderBy?: ProjectMemberOrderByWithRelationInput | ProjectMemberOrderByWithRelationInput[]
    cursor?: ProjectMemberWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ProjectMemberScalarFieldEnum | ProjectMemberScalarFieldEnum[]
  }


  /**
   * Project.publishedAsset
   */
  export type Project$publishedAssetArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MarketplaceAsset
     */
    select?: MarketplaceAssetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: MarketplaceAssetInclude<ExtArgs> | null
    where?: MarketplaceAssetWhereInput
  }


  /**
   * Project.clonedFrom
   */
  export type Project$clonedFromArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectClone
     */
    select?: ProjectCloneSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectCloneInclude<ExtArgs> | null
    where?: ProjectCloneWhereInput
  }


  /**
   * Project without action
   */
  export type ProjectDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Project
     */
    select?: ProjectSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectInclude<ExtArgs> | null
  }



  /**
   * Model ProjectMember
   */

  export type AggregateProjectMember = {
    _count: ProjectMemberCountAggregateOutputType | null
    _min: ProjectMemberMinAggregateOutputType | null
    _max: ProjectMemberMaxAggregateOutputType | null
  }

  export type ProjectMemberMinAggregateOutputType = {
    id: string | null
    projectId: string | null
    userId: string | null
    role: $Enums.ProjectRole | null
    createdAt: Date | null
  }

  export type ProjectMemberMaxAggregateOutputType = {
    id: string | null
    projectId: string | null
    userId: string | null
    role: $Enums.ProjectRole | null
    createdAt: Date | null
  }

  export type ProjectMemberCountAggregateOutputType = {
    id: number
    projectId: number
    userId: number
    role: number
    createdAt: number
    _all: number
  }


  export type ProjectMemberMinAggregateInputType = {
    id?: true
    projectId?: true
    userId?: true
    role?: true
    createdAt?: true
  }

  export type ProjectMemberMaxAggregateInputType = {
    id?: true
    projectId?: true
    userId?: true
    role?: true
    createdAt?: true
  }

  export type ProjectMemberCountAggregateInputType = {
    id?: true
    projectId?: true
    userId?: true
    role?: true
    createdAt?: true
    _all?: true
  }

  export type ProjectMemberAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ProjectMember to aggregate.
     */
    where?: ProjectMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ProjectMembers to fetch.
     */
    orderBy?: ProjectMemberOrderByWithRelationInput | ProjectMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ProjectMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ProjectMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ProjectMembers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned ProjectMembers
    **/
    _count?: true | ProjectMemberCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ProjectMemberMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ProjectMemberMaxAggregateInputType
  }

  export type GetProjectMemberAggregateType<T extends ProjectMemberAggregateArgs> = {
        [P in keyof T & keyof AggregateProjectMember]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateProjectMember[P]>
      : GetScalarType<T[P], AggregateProjectMember[P]>
  }




  export type ProjectMemberGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ProjectMemberWhereInput
    orderBy?: ProjectMemberOrderByWithAggregationInput | ProjectMemberOrderByWithAggregationInput[]
    by: ProjectMemberScalarFieldEnum[] | ProjectMemberScalarFieldEnum
    having?: ProjectMemberScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ProjectMemberCountAggregateInputType | true
    _min?: ProjectMemberMinAggregateInputType
    _max?: ProjectMemberMaxAggregateInputType
  }

  export type ProjectMemberGroupByOutputType = {
    id: string
    projectId: string
    userId: string
    role: $Enums.ProjectRole
    createdAt: Date
    _count: ProjectMemberCountAggregateOutputType | null
    _min: ProjectMemberMinAggregateOutputType | null
    _max: ProjectMemberMaxAggregateOutputType | null
  }

  type GetProjectMemberGroupByPayload<T extends ProjectMemberGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ProjectMemberGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ProjectMemberGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ProjectMemberGroupByOutputType[P]>
            : GetScalarType<T[P], ProjectMemberGroupByOutputType[P]>
        }
      >
    >


  export type ProjectMemberSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    projectId?: boolean
    userId?: boolean
    role?: boolean
    createdAt?: boolean
    project?: boolean | ProjectDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["projectMember"]>

  export type ProjectMemberSelectScalar = {
    id?: boolean
    projectId?: boolean
    userId?: boolean
    role?: boolean
    createdAt?: boolean
  }

  export type ProjectMemberInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    project?: boolean | ProjectDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }


  export type $ProjectMemberPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "ProjectMember"
    objects: {
      project: Prisma.$ProjectPayload<ExtArgs>
      user: Prisma.$UserPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      projectId: string
      userId: string
      role: $Enums.ProjectRole
      createdAt: Date
    }, ExtArgs["result"]["projectMember"]>
    composites: {}
  }


  type ProjectMemberGetPayload<S extends boolean | null | undefined | ProjectMemberDefaultArgs> = $Result.GetResult<Prisma.$ProjectMemberPayload, S>

  type ProjectMemberCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<ProjectMemberFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: ProjectMemberCountAggregateInputType | true
    }

  export interface ProjectMemberDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['ProjectMember'], meta: { name: 'ProjectMember' } }
    /**
     * Find zero or one ProjectMember that matches the filter.
     * @param {ProjectMemberFindUniqueArgs} args - Arguments to find a ProjectMember
     * @example
     * // Get one ProjectMember
     * const projectMember = await prisma.projectMember.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends ProjectMemberFindUniqueArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectMemberFindUniqueArgs<ExtArgs>>
    ): Prisma__ProjectMemberClient<$Result.GetResult<Prisma.$ProjectMemberPayload<ExtArgs>, T, 'findUnique'> | null, null, ExtArgs>

    /**
     * Find one ProjectMember that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {ProjectMemberFindUniqueOrThrowArgs} args - Arguments to find a ProjectMember
     * @example
     * // Get one ProjectMember
     * const projectMember = await prisma.projectMember.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends ProjectMemberFindUniqueOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectMemberFindUniqueOrThrowArgs<ExtArgs>>
    ): Prisma__ProjectMemberClient<$Result.GetResult<Prisma.$ProjectMemberPayload<ExtArgs>, T, 'findUniqueOrThrow'>, never, ExtArgs>

    /**
     * Find the first ProjectMember that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectMemberFindFirstArgs} args - Arguments to find a ProjectMember
     * @example
     * // Get one ProjectMember
     * const projectMember = await prisma.projectMember.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends ProjectMemberFindFirstArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectMemberFindFirstArgs<ExtArgs>>
    ): Prisma__ProjectMemberClient<$Result.GetResult<Prisma.$ProjectMemberPayload<ExtArgs>, T, 'findFirst'> | null, null, ExtArgs>

    /**
     * Find the first ProjectMember that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectMemberFindFirstOrThrowArgs} args - Arguments to find a ProjectMember
     * @example
     * // Get one ProjectMember
     * const projectMember = await prisma.projectMember.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends ProjectMemberFindFirstOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectMemberFindFirstOrThrowArgs<ExtArgs>>
    ): Prisma__ProjectMemberClient<$Result.GetResult<Prisma.$ProjectMemberPayload<ExtArgs>, T, 'findFirstOrThrow'>, never, ExtArgs>

    /**
     * Find zero or more ProjectMembers that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectMemberFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all ProjectMembers
     * const projectMembers = await prisma.projectMember.findMany()
     * 
     * // Get first 10 ProjectMembers
     * const projectMembers = await prisma.projectMember.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const projectMemberWithIdOnly = await prisma.projectMember.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends ProjectMemberFindManyArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectMemberFindManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ProjectMemberPayload<ExtArgs>, T, 'findMany'>>

    /**
     * Create a ProjectMember.
     * @param {ProjectMemberCreateArgs} args - Arguments to create a ProjectMember.
     * @example
     * // Create one ProjectMember
     * const ProjectMember = await prisma.projectMember.create({
     *   data: {
     *     // ... data to create a ProjectMember
     *   }
     * })
     * 
    **/
    create<T extends ProjectMemberCreateArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectMemberCreateArgs<ExtArgs>>
    ): Prisma__ProjectMemberClient<$Result.GetResult<Prisma.$ProjectMemberPayload<ExtArgs>, T, 'create'>, never, ExtArgs>

    /**
     * Create many ProjectMembers.
     *     @param {ProjectMemberCreateManyArgs} args - Arguments to create many ProjectMembers.
     *     @example
     *     // Create many ProjectMembers
     *     const projectMember = await prisma.projectMember.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends ProjectMemberCreateManyArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectMemberCreateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a ProjectMember.
     * @param {ProjectMemberDeleteArgs} args - Arguments to delete one ProjectMember.
     * @example
     * // Delete one ProjectMember
     * const ProjectMember = await prisma.projectMember.delete({
     *   where: {
     *     // ... filter to delete one ProjectMember
     *   }
     * })
     * 
    **/
    delete<T extends ProjectMemberDeleteArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectMemberDeleteArgs<ExtArgs>>
    ): Prisma__ProjectMemberClient<$Result.GetResult<Prisma.$ProjectMemberPayload<ExtArgs>, T, 'delete'>, never, ExtArgs>

    /**
     * Update one ProjectMember.
     * @param {ProjectMemberUpdateArgs} args - Arguments to update one ProjectMember.
     * @example
     * // Update one ProjectMember
     * const projectMember = await prisma.projectMember.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends ProjectMemberUpdateArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectMemberUpdateArgs<ExtArgs>>
    ): Prisma__ProjectMemberClient<$Result.GetResult<Prisma.$ProjectMemberPayload<ExtArgs>, T, 'update'>, never, ExtArgs>

    /**
     * Delete zero or more ProjectMembers.
     * @param {ProjectMemberDeleteManyArgs} args - Arguments to filter ProjectMembers to delete.
     * @example
     * // Delete a few ProjectMembers
     * const { count } = await prisma.projectMember.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends ProjectMemberDeleteManyArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectMemberDeleteManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more ProjectMembers.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectMemberUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many ProjectMembers
     * const projectMember = await prisma.projectMember.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends ProjectMemberUpdateManyArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectMemberUpdateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one ProjectMember.
     * @param {ProjectMemberUpsertArgs} args - Arguments to update or create a ProjectMember.
     * @example
     * // Update or create a ProjectMember
     * const projectMember = await prisma.projectMember.upsert({
     *   create: {
     *     // ... data to create a ProjectMember
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the ProjectMember we want to update
     *   }
     * })
    **/
    upsert<T extends ProjectMemberUpsertArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectMemberUpsertArgs<ExtArgs>>
    ): Prisma__ProjectMemberClient<$Result.GetResult<Prisma.$ProjectMemberPayload<ExtArgs>, T, 'upsert'>, never, ExtArgs>

    /**
     * Count the number of ProjectMembers.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectMemberCountArgs} args - Arguments to filter ProjectMembers to count.
     * @example
     * // Count the number of ProjectMembers
     * const count = await prisma.projectMember.count({
     *   where: {
     *     // ... the filter for the ProjectMembers we want to count
     *   }
     * })
    **/
    count<T extends ProjectMemberCountArgs>(
      args?: Subset<T, ProjectMemberCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ProjectMemberCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a ProjectMember.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectMemberAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends ProjectMemberAggregateArgs>(args: Subset<T, ProjectMemberAggregateArgs>): Prisma.PrismaPromise<GetProjectMemberAggregateType<T>>

    /**
     * Group by ProjectMember.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectMemberGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends ProjectMemberGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ProjectMemberGroupByArgs['orderBy'] }
        : { orderBy?: ProjectMemberGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, ProjectMemberGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetProjectMemberGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the ProjectMember model
   */
  readonly fields: ProjectMemberFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for ProjectMember.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ProjectMemberClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: 'PrismaPromise';

    project<T extends ProjectDefaultArgs<ExtArgs> = {}>(args?: Subset<T, ProjectDefaultArgs<ExtArgs>>): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, 'findUniqueOrThrow'> | Null, Null, ExtArgs>;

    user<T extends UserDefaultArgs<ExtArgs> = {}>(args?: Subset<T, UserDefaultArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, 'findUniqueOrThrow'> | Null, Null, ExtArgs>;

    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>;
  }



  /**
   * Fields of the ProjectMember model
   */ 
  interface ProjectMemberFieldRefs {
    readonly id: FieldRef<"ProjectMember", 'String'>
    readonly projectId: FieldRef<"ProjectMember", 'String'>
    readonly userId: FieldRef<"ProjectMember", 'String'>
    readonly role: FieldRef<"ProjectMember", 'ProjectRole'>
    readonly createdAt: FieldRef<"ProjectMember", 'DateTime'>
  }
    

  // Custom InputTypes

  /**
   * ProjectMember findUnique
   */
  export type ProjectMemberFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectMember
     */
    select?: ProjectMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectMemberInclude<ExtArgs> | null
    /**
     * Filter, which ProjectMember to fetch.
     */
    where: ProjectMemberWhereUniqueInput
  }


  /**
   * ProjectMember findUniqueOrThrow
   */
  export type ProjectMemberFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectMember
     */
    select?: ProjectMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectMemberInclude<ExtArgs> | null
    /**
     * Filter, which ProjectMember to fetch.
     */
    where: ProjectMemberWhereUniqueInput
  }


  /**
   * ProjectMember findFirst
   */
  export type ProjectMemberFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectMember
     */
    select?: ProjectMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectMemberInclude<ExtArgs> | null
    /**
     * Filter, which ProjectMember to fetch.
     */
    where?: ProjectMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ProjectMembers to fetch.
     */
    orderBy?: ProjectMemberOrderByWithRelationInput | ProjectMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ProjectMembers.
     */
    cursor?: ProjectMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ProjectMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ProjectMembers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ProjectMembers.
     */
    distinct?: ProjectMemberScalarFieldEnum | ProjectMemberScalarFieldEnum[]
  }


  /**
   * ProjectMember findFirstOrThrow
   */
  export type ProjectMemberFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectMember
     */
    select?: ProjectMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectMemberInclude<ExtArgs> | null
    /**
     * Filter, which ProjectMember to fetch.
     */
    where?: ProjectMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ProjectMembers to fetch.
     */
    orderBy?: ProjectMemberOrderByWithRelationInput | ProjectMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ProjectMembers.
     */
    cursor?: ProjectMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ProjectMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ProjectMembers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ProjectMembers.
     */
    distinct?: ProjectMemberScalarFieldEnum | ProjectMemberScalarFieldEnum[]
  }


  /**
   * ProjectMember findMany
   */
  export type ProjectMemberFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectMember
     */
    select?: ProjectMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectMemberInclude<ExtArgs> | null
    /**
     * Filter, which ProjectMembers to fetch.
     */
    where?: ProjectMemberWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ProjectMembers to fetch.
     */
    orderBy?: ProjectMemberOrderByWithRelationInput | ProjectMemberOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing ProjectMembers.
     */
    cursor?: ProjectMemberWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ProjectMembers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ProjectMembers.
     */
    skip?: number
    distinct?: ProjectMemberScalarFieldEnum | ProjectMemberScalarFieldEnum[]
  }


  /**
   * ProjectMember create
   */
  export type ProjectMemberCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectMember
     */
    select?: ProjectMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectMemberInclude<ExtArgs> | null
    /**
     * The data needed to create a ProjectMember.
     */
    data: XOR<ProjectMemberCreateInput, ProjectMemberUncheckedCreateInput>
  }


  /**
   * ProjectMember createMany
   */
  export type ProjectMemberCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many ProjectMembers.
     */
    data: ProjectMemberCreateManyInput | ProjectMemberCreateManyInput[]
    skipDuplicates?: boolean
  }


  /**
   * ProjectMember update
   */
  export type ProjectMemberUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectMember
     */
    select?: ProjectMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectMemberInclude<ExtArgs> | null
    /**
     * The data needed to update a ProjectMember.
     */
    data: XOR<ProjectMemberUpdateInput, ProjectMemberUncheckedUpdateInput>
    /**
     * Choose, which ProjectMember to update.
     */
    where: ProjectMemberWhereUniqueInput
  }


  /**
   * ProjectMember updateMany
   */
  export type ProjectMemberUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update ProjectMembers.
     */
    data: XOR<ProjectMemberUpdateManyMutationInput, ProjectMemberUncheckedUpdateManyInput>
    /**
     * Filter which ProjectMembers to update
     */
    where?: ProjectMemberWhereInput
  }


  /**
   * ProjectMember upsert
   */
  export type ProjectMemberUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectMember
     */
    select?: ProjectMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectMemberInclude<ExtArgs> | null
    /**
     * The filter to search for the ProjectMember to update in case it exists.
     */
    where: ProjectMemberWhereUniqueInput
    /**
     * In case the ProjectMember found by the `where` argument doesn't exist, create a new ProjectMember with this data.
     */
    create: XOR<ProjectMemberCreateInput, ProjectMemberUncheckedCreateInput>
    /**
     * In case the ProjectMember was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ProjectMemberUpdateInput, ProjectMemberUncheckedUpdateInput>
  }


  /**
   * ProjectMember delete
   */
  export type ProjectMemberDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectMember
     */
    select?: ProjectMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectMemberInclude<ExtArgs> | null
    /**
     * Filter which ProjectMember to delete.
     */
    where: ProjectMemberWhereUniqueInput
  }


  /**
   * ProjectMember deleteMany
   */
  export type ProjectMemberDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ProjectMembers to delete
     */
    where?: ProjectMemberWhereInput
  }


  /**
   * ProjectMember without action
   */
  export type ProjectMemberDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectMember
     */
    select?: ProjectMemberSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectMemberInclude<ExtArgs> | null
  }



  /**
   * Model MarketplaceAsset
   */

  export type AggregateMarketplaceAsset = {
    _count: MarketplaceAssetCountAggregateOutputType | null
    _avg: MarketplaceAssetAvgAggregateOutputType | null
    _sum: MarketplaceAssetSumAggregateOutputType | null
    _min: MarketplaceAssetMinAggregateOutputType | null
    _max: MarketplaceAssetMaxAggregateOutputType | null
  }

  export type MarketplaceAssetAvgAggregateOutputType = {
    cloneCount: number | null
  }

  export type MarketplaceAssetSumAggregateOutputType = {
    cloneCount: number | null
  }

  export type MarketplaceAssetMinAggregateOutputType = {
    id: string | null
    projectId: string | null
    authorId: string | null
    title: string | null
    description: string | null
    thumbnailUrl: string | null
    isPublished: boolean | null
    cloneCount: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type MarketplaceAssetMaxAggregateOutputType = {
    id: string | null
    projectId: string | null
    authorId: string | null
    title: string | null
    description: string | null
    thumbnailUrl: string | null
    isPublished: boolean | null
    cloneCount: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type MarketplaceAssetCountAggregateOutputType = {
    id: number
    projectId: number
    authorId: number
    title: number
    description: number
    tags: number
    thumbnailUrl: number
    isPublished: number
    cloneCount: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type MarketplaceAssetAvgAggregateInputType = {
    cloneCount?: true
  }

  export type MarketplaceAssetSumAggregateInputType = {
    cloneCount?: true
  }

  export type MarketplaceAssetMinAggregateInputType = {
    id?: true
    projectId?: true
    authorId?: true
    title?: true
    description?: true
    thumbnailUrl?: true
    isPublished?: true
    cloneCount?: true
    createdAt?: true
    updatedAt?: true
  }

  export type MarketplaceAssetMaxAggregateInputType = {
    id?: true
    projectId?: true
    authorId?: true
    title?: true
    description?: true
    thumbnailUrl?: true
    isPublished?: true
    cloneCount?: true
    createdAt?: true
    updatedAt?: true
  }

  export type MarketplaceAssetCountAggregateInputType = {
    id?: true
    projectId?: true
    authorId?: true
    title?: true
    description?: true
    tags?: true
    thumbnailUrl?: true
    isPublished?: true
    cloneCount?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type MarketplaceAssetAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which MarketplaceAsset to aggregate.
     */
    where?: MarketplaceAssetWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MarketplaceAssets to fetch.
     */
    orderBy?: MarketplaceAssetOrderByWithRelationInput | MarketplaceAssetOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: MarketplaceAssetWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MarketplaceAssets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MarketplaceAssets.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned MarketplaceAssets
    **/
    _count?: true | MarketplaceAssetCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: MarketplaceAssetAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: MarketplaceAssetSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: MarketplaceAssetMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: MarketplaceAssetMaxAggregateInputType
  }

  export type GetMarketplaceAssetAggregateType<T extends MarketplaceAssetAggregateArgs> = {
        [P in keyof T & keyof AggregateMarketplaceAsset]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateMarketplaceAsset[P]>
      : GetScalarType<T[P], AggregateMarketplaceAsset[P]>
  }




  export type MarketplaceAssetGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: MarketplaceAssetWhereInput
    orderBy?: MarketplaceAssetOrderByWithAggregationInput | MarketplaceAssetOrderByWithAggregationInput[]
    by: MarketplaceAssetScalarFieldEnum[] | MarketplaceAssetScalarFieldEnum
    having?: MarketplaceAssetScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: MarketplaceAssetCountAggregateInputType | true
    _avg?: MarketplaceAssetAvgAggregateInputType
    _sum?: MarketplaceAssetSumAggregateInputType
    _min?: MarketplaceAssetMinAggregateInputType
    _max?: MarketplaceAssetMaxAggregateInputType
  }

  export type MarketplaceAssetGroupByOutputType = {
    id: string
    projectId: string
    authorId: string
    title: string
    description: string | null
    tags: string[]
    thumbnailUrl: string | null
    isPublished: boolean
    cloneCount: number
    createdAt: Date
    updatedAt: Date
    _count: MarketplaceAssetCountAggregateOutputType | null
    _avg: MarketplaceAssetAvgAggregateOutputType | null
    _sum: MarketplaceAssetSumAggregateOutputType | null
    _min: MarketplaceAssetMinAggregateOutputType | null
    _max: MarketplaceAssetMaxAggregateOutputType | null
  }

  type GetMarketplaceAssetGroupByPayload<T extends MarketplaceAssetGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<MarketplaceAssetGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof MarketplaceAssetGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], MarketplaceAssetGroupByOutputType[P]>
            : GetScalarType<T[P], MarketplaceAssetGroupByOutputType[P]>
        }
      >
    >


  export type MarketplaceAssetSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    projectId?: boolean
    authorId?: boolean
    title?: boolean
    description?: boolean
    tags?: boolean
    thumbnailUrl?: boolean
    isPublished?: boolean
    cloneCount?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    project?: boolean | ProjectDefaultArgs<ExtArgs>
    author?: boolean | UserDefaultArgs<ExtArgs>
    clones?: boolean | MarketplaceAsset$clonesArgs<ExtArgs>
    _count?: boolean | MarketplaceAssetCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["marketplaceAsset"]>

  export type MarketplaceAssetSelectScalar = {
    id?: boolean
    projectId?: boolean
    authorId?: boolean
    title?: boolean
    description?: boolean
    tags?: boolean
    thumbnailUrl?: boolean
    isPublished?: boolean
    cloneCount?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type MarketplaceAssetInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    project?: boolean | ProjectDefaultArgs<ExtArgs>
    author?: boolean | UserDefaultArgs<ExtArgs>
    clones?: boolean | MarketplaceAsset$clonesArgs<ExtArgs>
    _count?: boolean | MarketplaceAssetCountOutputTypeDefaultArgs<ExtArgs>
  }


  export type $MarketplaceAssetPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "MarketplaceAsset"
    objects: {
      project: Prisma.$ProjectPayload<ExtArgs>
      author: Prisma.$UserPayload<ExtArgs>
      clones: Prisma.$ProjectClonePayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      projectId: string
      authorId: string
      title: string
      description: string | null
      tags: string[]
      thumbnailUrl: string | null
      isPublished: boolean
      cloneCount: number
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["marketplaceAsset"]>
    composites: {}
  }


  type MarketplaceAssetGetPayload<S extends boolean | null | undefined | MarketplaceAssetDefaultArgs> = $Result.GetResult<Prisma.$MarketplaceAssetPayload, S>

  type MarketplaceAssetCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<MarketplaceAssetFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: MarketplaceAssetCountAggregateInputType | true
    }

  export interface MarketplaceAssetDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['MarketplaceAsset'], meta: { name: 'MarketplaceAsset' } }
    /**
     * Find zero or one MarketplaceAsset that matches the filter.
     * @param {MarketplaceAssetFindUniqueArgs} args - Arguments to find a MarketplaceAsset
     * @example
     * // Get one MarketplaceAsset
     * const marketplaceAsset = await prisma.marketplaceAsset.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends MarketplaceAssetFindUniqueArgs<ExtArgs>>(
      args: SelectSubset<T, MarketplaceAssetFindUniqueArgs<ExtArgs>>
    ): Prisma__MarketplaceAssetClient<$Result.GetResult<Prisma.$MarketplaceAssetPayload<ExtArgs>, T, 'findUnique'> | null, null, ExtArgs>

    /**
     * Find one MarketplaceAsset that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {MarketplaceAssetFindUniqueOrThrowArgs} args - Arguments to find a MarketplaceAsset
     * @example
     * // Get one MarketplaceAsset
     * const marketplaceAsset = await prisma.marketplaceAsset.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends MarketplaceAssetFindUniqueOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, MarketplaceAssetFindUniqueOrThrowArgs<ExtArgs>>
    ): Prisma__MarketplaceAssetClient<$Result.GetResult<Prisma.$MarketplaceAssetPayload<ExtArgs>, T, 'findUniqueOrThrow'>, never, ExtArgs>

    /**
     * Find the first MarketplaceAsset that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MarketplaceAssetFindFirstArgs} args - Arguments to find a MarketplaceAsset
     * @example
     * // Get one MarketplaceAsset
     * const marketplaceAsset = await prisma.marketplaceAsset.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends MarketplaceAssetFindFirstArgs<ExtArgs>>(
      args?: SelectSubset<T, MarketplaceAssetFindFirstArgs<ExtArgs>>
    ): Prisma__MarketplaceAssetClient<$Result.GetResult<Prisma.$MarketplaceAssetPayload<ExtArgs>, T, 'findFirst'> | null, null, ExtArgs>

    /**
     * Find the first MarketplaceAsset that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MarketplaceAssetFindFirstOrThrowArgs} args - Arguments to find a MarketplaceAsset
     * @example
     * // Get one MarketplaceAsset
     * const marketplaceAsset = await prisma.marketplaceAsset.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends MarketplaceAssetFindFirstOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, MarketplaceAssetFindFirstOrThrowArgs<ExtArgs>>
    ): Prisma__MarketplaceAssetClient<$Result.GetResult<Prisma.$MarketplaceAssetPayload<ExtArgs>, T, 'findFirstOrThrow'>, never, ExtArgs>

    /**
     * Find zero or more MarketplaceAssets that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MarketplaceAssetFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all MarketplaceAssets
     * const marketplaceAssets = await prisma.marketplaceAsset.findMany()
     * 
     * // Get first 10 MarketplaceAssets
     * const marketplaceAssets = await prisma.marketplaceAsset.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const marketplaceAssetWithIdOnly = await prisma.marketplaceAsset.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends MarketplaceAssetFindManyArgs<ExtArgs>>(
      args?: SelectSubset<T, MarketplaceAssetFindManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<$Result.GetResult<Prisma.$MarketplaceAssetPayload<ExtArgs>, T, 'findMany'>>

    /**
     * Create a MarketplaceAsset.
     * @param {MarketplaceAssetCreateArgs} args - Arguments to create a MarketplaceAsset.
     * @example
     * // Create one MarketplaceAsset
     * const MarketplaceAsset = await prisma.marketplaceAsset.create({
     *   data: {
     *     // ... data to create a MarketplaceAsset
     *   }
     * })
     * 
    **/
    create<T extends MarketplaceAssetCreateArgs<ExtArgs>>(
      args: SelectSubset<T, MarketplaceAssetCreateArgs<ExtArgs>>
    ): Prisma__MarketplaceAssetClient<$Result.GetResult<Prisma.$MarketplaceAssetPayload<ExtArgs>, T, 'create'>, never, ExtArgs>

    /**
     * Create many MarketplaceAssets.
     *     @param {MarketplaceAssetCreateManyArgs} args - Arguments to create many MarketplaceAssets.
     *     @example
     *     // Create many MarketplaceAssets
     *     const marketplaceAsset = await prisma.marketplaceAsset.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends MarketplaceAssetCreateManyArgs<ExtArgs>>(
      args?: SelectSubset<T, MarketplaceAssetCreateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a MarketplaceAsset.
     * @param {MarketplaceAssetDeleteArgs} args - Arguments to delete one MarketplaceAsset.
     * @example
     * // Delete one MarketplaceAsset
     * const MarketplaceAsset = await prisma.marketplaceAsset.delete({
     *   where: {
     *     // ... filter to delete one MarketplaceAsset
     *   }
     * })
     * 
    **/
    delete<T extends MarketplaceAssetDeleteArgs<ExtArgs>>(
      args: SelectSubset<T, MarketplaceAssetDeleteArgs<ExtArgs>>
    ): Prisma__MarketplaceAssetClient<$Result.GetResult<Prisma.$MarketplaceAssetPayload<ExtArgs>, T, 'delete'>, never, ExtArgs>

    /**
     * Update one MarketplaceAsset.
     * @param {MarketplaceAssetUpdateArgs} args - Arguments to update one MarketplaceAsset.
     * @example
     * // Update one MarketplaceAsset
     * const marketplaceAsset = await prisma.marketplaceAsset.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends MarketplaceAssetUpdateArgs<ExtArgs>>(
      args: SelectSubset<T, MarketplaceAssetUpdateArgs<ExtArgs>>
    ): Prisma__MarketplaceAssetClient<$Result.GetResult<Prisma.$MarketplaceAssetPayload<ExtArgs>, T, 'update'>, never, ExtArgs>

    /**
     * Delete zero or more MarketplaceAssets.
     * @param {MarketplaceAssetDeleteManyArgs} args - Arguments to filter MarketplaceAssets to delete.
     * @example
     * // Delete a few MarketplaceAssets
     * const { count } = await prisma.marketplaceAsset.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends MarketplaceAssetDeleteManyArgs<ExtArgs>>(
      args?: SelectSubset<T, MarketplaceAssetDeleteManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more MarketplaceAssets.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MarketplaceAssetUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many MarketplaceAssets
     * const marketplaceAsset = await prisma.marketplaceAsset.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends MarketplaceAssetUpdateManyArgs<ExtArgs>>(
      args: SelectSubset<T, MarketplaceAssetUpdateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one MarketplaceAsset.
     * @param {MarketplaceAssetUpsertArgs} args - Arguments to update or create a MarketplaceAsset.
     * @example
     * // Update or create a MarketplaceAsset
     * const marketplaceAsset = await prisma.marketplaceAsset.upsert({
     *   create: {
     *     // ... data to create a MarketplaceAsset
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the MarketplaceAsset we want to update
     *   }
     * })
    **/
    upsert<T extends MarketplaceAssetUpsertArgs<ExtArgs>>(
      args: SelectSubset<T, MarketplaceAssetUpsertArgs<ExtArgs>>
    ): Prisma__MarketplaceAssetClient<$Result.GetResult<Prisma.$MarketplaceAssetPayload<ExtArgs>, T, 'upsert'>, never, ExtArgs>

    /**
     * Count the number of MarketplaceAssets.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MarketplaceAssetCountArgs} args - Arguments to filter MarketplaceAssets to count.
     * @example
     * // Count the number of MarketplaceAssets
     * const count = await prisma.marketplaceAsset.count({
     *   where: {
     *     // ... the filter for the MarketplaceAssets we want to count
     *   }
     * })
    **/
    count<T extends MarketplaceAssetCountArgs>(
      args?: Subset<T, MarketplaceAssetCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], MarketplaceAssetCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a MarketplaceAsset.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MarketplaceAssetAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends MarketplaceAssetAggregateArgs>(args: Subset<T, MarketplaceAssetAggregateArgs>): Prisma.PrismaPromise<GetMarketplaceAssetAggregateType<T>>

    /**
     * Group by MarketplaceAsset.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {MarketplaceAssetGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends MarketplaceAssetGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: MarketplaceAssetGroupByArgs['orderBy'] }
        : { orderBy?: MarketplaceAssetGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, MarketplaceAssetGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetMarketplaceAssetGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the MarketplaceAsset model
   */
  readonly fields: MarketplaceAssetFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for MarketplaceAsset.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__MarketplaceAssetClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: 'PrismaPromise';

    project<T extends ProjectDefaultArgs<ExtArgs> = {}>(args?: Subset<T, ProjectDefaultArgs<ExtArgs>>): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, 'findUniqueOrThrow'> | Null, Null, ExtArgs>;

    author<T extends UserDefaultArgs<ExtArgs> = {}>(args?: Subset<T, UserDefaultArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, 'findUniqueOrThrow'> | Null, Null, ExtArgs>;

    clones<T extends MarketplaceAsset$clonesArgs<ExtArgs> = {}>(args?: Subset<T, MarketplaceAsset$clonesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ProjectClonePayload<ExtArgs>, T, 'findMany'> | Null>;

    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>;
  }



  /**
   * Fields of the MarketplaceAsset model
   */ 
  interface MarketplaceAssetFieldRefs {
    readonly id: FieldRef<"MarketplaceAsset", 'String'>
    readonly projectId: FieldRef<"MarketplaceAsset", 'String'>
    readonly authorId: FieldRef<"MarketplaceAsset", 'String'>
    readonly title: FieldRef<"MarketplaceAsset", 'String'>
    readonly description: FieldRef<"MarketplaceAsset", 'String'>
    readonly tags: FieldRef<"MarketplaceAsset", 'String[]'>
    readonly thumbnailUrl: FieldRef<"MarketplaceAsset", 'String'>
    readonly isPublished: FieldRef<"MarketplaceAsset", 'Boolean'>
    readonly cloneCount: FieldRef<"MarketplaceAsset", 'Int'>
    readonly createdAt: FieldRef<"MarketplaceAsset", 'DateTime'>
    readonly updatedAt: FieldRef<"MarketplaceAsset", 'DateTime'>
  }
    

  // Custom InputTypes

  /**
   * MarketplaceAsset findUnique
   */
  export type MarketplaceAssetFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MarketplaceAsset
     */
    select?: MarketplaceAssetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: MarketplaceAssetInclude<ExtArgs> | null
    /**
     * Filter, which MarketplaceAsset to fetch.
     */
    where: MarketplaceAssetWhereUniqueInput
  }


  /**
   * MarketplaceAsset findUniqueOrThrow
   */
  export type MarketplaceAssetFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MarketplaceAsset
     */
    select?: MarketplaceAssetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: MarketplaceAssetInclude<ExtArgs> | null
    /**
     * Filter, which MarketplaceAsset to fetch.
     */
    where: MarketplaceAssetWhereUniqueInput
  }


  /**
   * MarketplaceAsset findFirst
   */
  export type MarketplaceAssetFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MarketplaceAsset
     */
    select?: MarketplaceAssetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: MarketplaceAssetInclude<ExtArgs> | null
    /**
     * Filter, which MarketplaceAsset to fetch.
     */
    where?: MarketplaceAssetWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MarketplaceAssets to fetch.
     */
    orderBy?: MarketplaceAssetOrderByWithRelationInput | MarketplaceAssetOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for MarketplaceAssets.
     */
    cursor?: MarketplaceAssetWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MarketplaceAssets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MarketplaceAssets.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of MarketplaceAssets.
     */
    distinct?: MarketplaceAssetScalarFieldEnum | MarketplaceAssetScalarFieldEnum[]
  }


  /**
   * MarketplaceAsset findFirstOrThrow
   */
  export type MarketplaceAssetFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MarketplaceAsset
     */
    select?: MarketplaceAssetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: MarketplaceAssetInclude<ExtArgs> | null
    /**
     * Filter, which MarketplaceAsset to fetch.
     */
    where?: MarketplaceAssetWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MarketplaceAssets to fetch.
     */
    orderBy?: MarketplaceAssetOrderByWithRelationInput | MarketplaceAssetOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for MarketplaceAssets.
     */
    cursor?: MarketplaceAssetWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MarketplaceAssets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MarketplaceAssets.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of MarketplaceAssets.
     */
    distinct?: MarketplaceAssetScalarFieldEnum | MarketplaceAssetScalarFieldEnum[]
  }


  /**
   * MarketplaceAsset findMany
   */
  export type MarketplaceAssetFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MarketplaceAsset
     */
    select?: MarketplaceAssetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: MarketplaceAssetInclude<ExtArgs> | null
    /**
     * Filter, which MarketplaceAssets to fetch.
     */
    where?: MarketplaceAssetWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of MarketplaceAssets to fetch.
     */
    orderBy?: MarketplaceAssetOrderByWithRelationInput | MarketplaceAssetOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing MarketplaceAssets.
     */
    cursor?: MarketplaceAssetWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` MarketplaceAssets from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` MarketplaceAssets.
     */
    skip?: number
    distinct?: MarketplaceAssetScalarFieldEnum | MarketplaceAssetScalarFieldEnum[]
  }


  /**
   * MarketplaceAsset create
   */
  export type MarketplaceAssetCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MarketplaceAsset
     */
    select?: MarketplaceAssetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: MarketplaceAssetInclude<ExtArgs> | null
    /**
     * The data needed to create a MarketplaceAsset.
     */
    data: XOR<MarketplaceAssetCreateInput, MarketplaceAssetUncheckedCreateInput>
  }


  /**
   * MarketplaceAsset createMany
   */
  export type MarketplaceAssetCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many MarketplaceAssets.
     */
    data: MarketplaceAssetCreateManyInput | MarketplaceAssetCreateManyInput[]
    skipDuplicates?: boolean
  }


  /**
   * MarketplaceAsset update
   */
  export type MarketplaceAssetUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MarketplaceAsset
     */
    select?: MarketplaceAssetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: MarketplaceAssetInclude<ExtArgs> | null
    /**
     * The data needed to update a MarketplaceAsset.
     */
    data: XOR<MarketplaceAssetUpdateInput, MarketplaceAssetUncheckedUpdateInput>
    /**
     * Choose, which MarketplaceAsset to update.
     */
    where: MarketplaceAssetWhereUniqueInput
  }


  /**
   * MarketplaceAsset updateMany
   */
  export type MarketplaceAssetUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update MarketplaceAssets.
     */
    data: XOR<MarketplaceAssetUpdateManyMutationInput, MarketplaceAssetUncheckedUpdateManyInput>
    /**
     * Filter which MarketplaceAssets to update
     */
    where?: MarketplaceAssetWhereInput
  }


  /**
   * MarketplaceAsset upsert
   */
  export type MarketplaceAssetUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MarketplaceAsset
     */
    select?: MarketplaceAssetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: MarketplaceAssetInclude<ExtArgs> | null
    /**
     * The filter to search for the MarketplaceAsset to update in case it exists.
     */
    where: MarketplaceAssetWhereUniqueInput
    /**
     * In case the MarketplaceAsset found by the `where` argument doesn't exist, create a new MarketplaceAsset with this data.
     */
    create: XOR<MarketplaceAssetCreateInput, MarketplaceAssetUncheckedCreateInput>
    /**
     * In case the MarketplaceAsset was found with the provided `where` argument, update it with this data.
     */
    update: XOR<MarketplaceAssetUpdateInput, MarketplaceAssetUncheckedUpdateInput>
  }


  /**
   * MarketplaceAsset delete
   */
  export type MarketplaceAssetDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MarketplaceAsset
     */
    select?: MarketplaceAssetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: MarketplaceAssetInclude<ExtArgs> | null
    /**
     * Filter which MarketplaceAsset to delete.
     */
    where: MarketplaceAssetWhereUniqueInput
  }


  /**
   * MarketplaceAsset deleteMany
   */
  export type MarketplaceAssetDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which MarketplaceAssets to delete
     */
    where?: MarketplaceAssetWhereInput
  }


  /**
   * MarketplaceAsset.clones
   */
  export type MarketplaceAsset$clonesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectClone
     */
    select?: ProjectCloneSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectCloneInclude<ExtArgs> | null
    where?: ProjectCloneWhereInput
    orderBy?: ProjectCloneOrderByWithRelationInput | ProjectCloneOrderByWithRelationInput[]
    cursor?: ProjectCloneWhereUniqueInput
    take?: number
    skip?: number
    distinct?: ProjectCloneScalarFieldEnum | ProjectCloneScalarFieldEnum[]
  }


  /**
   * MarketplaceAsset without action
   */
  export type MarketplaceAssetDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the MarketplaceAsset
     */
    select?: MarketplaceAssetSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: MarketplaceAssetInclude<ExtArgs> | null
  }



  /**
   * Model ProjectClone
   */

  export type AggregateProjectClone = {
    _count: ProjectCloneCountAggregateOutputType | null
    _min: ProjectCloneMinAggregateOutputType | null
    _max: ProjectCloneMaxAggregateOutputType | null
  }

  export type ProjectCloneMinAggregateOutputType = {
    id: string | null
    sourceAssetId: string | null
    clonedProjectId: string | null
    clonedByUserId: string | null
    createdAt: Date | null
  }

  export type ProjectCloneMaxAggregateOutputType = {
    id: string | null
    sourceAssetId: string | null
    clonedProjectId: string | null
    clonedByUserId: string | null
    createdAt: Date | null
  }

  export type ProjectCloneCountAggregateOutputType = {
    id: number
    sourceAssetId: number
    clonedProjectId: number
    clonedByUserId: number
    createdAt: number
    _all: number
  }


  export type ProjectCloneMinAggregateInputType = {
    id?: true
    sourceAssetId?: true
    clonedProjectId?: true
    clonedByUserId?: true
    createdAt?: true
  }

  export type ProjectCloneMaxAggregateInputType = {
    id?: true
    sourceAssetId?: true
    clonedProjectId?: true
    clonedByUserId?: true
    createdAt?: true
  }

  export type ProjectCloneCountAggregateInputType = {
    id?: true
    sourceAssetId?: true
    clonedProjectId?: true
    clonedByUserId?: true
    createdAt?: true
    _all?: true
  }

  export type ProjectCloneAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ProjectClone to aggregate.
     */
    where?: ProjectCloneWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ProjectClones to fetch.
     */
    orderBy?: ProjectCloneOrderByWithRelationInput | ProjectCloneOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: ProjectCloneWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ProjectClones from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ProjectClones.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned ProjectClones
    **/
    _count?: true | ProjectCloneCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: ProjectCloneMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: ProjectCloneMaxAggregateInputType
  }

  export type GetProjectCloneAggregateType<T extends ProjectCloneAggregateArgs> = {
        [P in keyof T & keyof AggregateProjectClone]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateProjectClone[P]>
      : GetScalarType<T[P], AggregateProjectClone[P]>
  }




  export type ProjectCloneGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: ProjectCloneWhereInput
    orderBy?: ProjectCloneOrderByWithAggregationInput | ProjectCloneOrderByWithAggregationInput[]
    by: ProjectCloneScalarFieldEnum[] | ProjectCloneScalarFieldEnum
    having?: ProjectCloneScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: ProjectCloneCountAggregateInputType | true
    _min?: ProjectCloneMinAggregateInputType
    _max?: ProjectCloneMaxAggregateInputType
  }

  export type ProjectCloneGroupByOutputType = {
    id: string
    sourceAssetId: string
    clonedProjectId: string
    clonedByUserId: string
    createdAt: Date
    _count: ProjectCloneCountAggregateOutputType | null
    _min: ProjectCloneMinAggregateOutputType | null
    _max: ProjectCloneMaxAggregateOutputType | null
  }

  type GetProjectCloneGroupByPayload<T extends ProjectCloneGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<ProjectCloneGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof ProjectCloneGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], ProjectCloneGroupByOutputType[P]>
            : GetScalarType<T[P], ProjectCloneGroupByOutputType[P]>
        }
      >
    >


  export type ProjectCloneSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    sourceAssetId?: boolean
    clonedProjectId?: boolean
    clonedByUserId?: boolean
    createdAt?: boolean
    asset?: boolean | MarketplaceAssetDefaultArgs<ExtArgs>
    clonedProject?: boolean | ProjectDefaultArgs<ExtArgs>
    clonedBy?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["projectClone"]>

  export type ProjectCloneSelectScalar = {
    id?: boolean
    sourceAssetId?: boolean
    clonedProjectId?: boolean
    clonedByUserId?: boolean
    createdAt?: boolean
  }

  export type ProjectCloneInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    asset?: boolean | MarketplaceAssetDefaultArgs<ExtArgs>
    clonedProject?: boolean | ProjectDefaultArgs<ExtArgs>
    clonedBy?: boolean | UserDefaultArgs<ExtArgs>
  }


  export type $ProjectClonePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "ProjectClone"
    objects: {
      asset: Prisma.$MarketplaceAssetPayload<ExtArgs>
      clonedProject: Prisma.$ProjectPayload<ExtArgs>
      clonedBy: Prisma.$UserPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      sourceAssetId: string
      clonedProjectId: string
      clonedByUserId: string
      createdAt: Date
    }, ExtArgs["result"]["projectClone"]>
    composites: {}
  }


  type ProjectCloneGetPayload<S extends boolean | null | undefined | ProjectCloneDefaultArgs> = $Result.GetResult<Prisma.$ProjectClonePayload, S>

  type ProjectCloneCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<ProjectCloneFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: ProjectCloneCountAggregateInputType | true
    }

  export interface ProjectCloneDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['ProjectClone'], meta: { name: 'ProjectClone' } }
    /**
     * Find zero or one ProjectClone that matches the filter.
     * @param {ProjectCloneFindUniqueArgs} args - Arguments to find a ProjectClone
     * @example
     * // Get one ProjectClone
     * const projectClone = await prisma.projectClone.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends ProjectCloneFindUniqueArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectCloneFindUniqueArgs<ExtArgs>>
    ): Prisma__ProjectCloneClient<$Result.GetResult<Prisma.$ProjectClonePayload<ExtArgs>, T, 'findUnique'> | null, null, ExtArgs>

    /**
     * Find one ProjectClone that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {ProjectCloneFindUniqueOrThrowArgs} args - Arguments to find a ProjectClone
     * @example
     * // Get one ProjectClone
     * const projectClone = await prisma.projectClone.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends ProjectCloneFindUniqueOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectCloneFindUniqueOrThrowArgs<ExtArgs>>
    ): Prisma__ProjectCloneClient<$Result.GetResult<Prisma.$ProjectClonePayload<ExtArgs>, T, 'findUniqueOrThrow'>, never, ExtArgs>

    /**
     * Find the first ProjectClone that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectCloneFindFirstArgs} args - Arguments to find a ProjectClone
     * @example
     * // Get one ProjectClone
     * const projectClone = await prisma.projectClone.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends ProjectCloneFindFirstArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectCloneFindFirstArgs<ExtArgs>>
    ): Prisma__ProjectCloneClient<$Result.GetResult<Prisma.$ProjectClonePayload<ExtArgs>, T, 'findFirst'> | null, null, ExtArgs>

    /**
     * Find the first ProjectClone that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectCloneFindFirstOrThrowArgs} args - Arguments to find a ProjectClone
     * @example
     * // Get one ProjectClone
     * const projectClone = await prisma.projectClone.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends ProjectCloneFindFirstOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectCloneFindFirstOrThrowArgs<ExtArgs>>
    ): Prisma__ProjectCloneClient<$Result.GetResult<Prisma.$ProjectClonePayload<ExtArgs>, T, 'findFirstOrThrow'>, never, ExtArgs>

    /**
     * Find zero or more ProjectClones that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectCloneFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all ProjectClones
     * const projectClones = await prisma.projectClone.findMany()
     * 
     * // Get first 10 ProjectClones
     * const projectClones = await prisma.projectClone.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const projectCloneWithIdOnly = await prisma.projectClone.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends ProjectCloneFindManyArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectCloneFindManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<$Result.GetResult<Prisma.$ProjectClonePayload<ExtArgs>, T, 'findMany'>>

    /**
     * Create a ProjectClone.
     * @param {ProjectCloneCreateArgs} args - Arguments to create a ProjectClone.
     * @example
     * // Create one ProjectClone
     * const ProjectClone = await prisma.projectClone.create({
     *   data: {
     *     // ... data to create a ProjectClone
     *   }
     * })
     * 
    **/
    create<T extends ProjectCloneCreateArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectCloneCreateArgs<ExtArgs>>
    ): Prisma__ProjectCloneClient<$Result.GetResult<Prisma.$ProjectClonePayload<ExtArgs>, T, 'create'>, never, ExtArgs>

    /**
     * Create many ProjectClones.
     *     @param {ProjectCloneCreateManyArgs} args - Arguments to create many ProjectClones.
     *     @example
     *     // Create many ProjectClones
     *     const projectClone = await prisma.projectClone.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends ProjectCloneCreateManyArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectCloneCreateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a ProjectClone.
     * @param {ProjectCloneDeleteArgs} args - Arguments to delete one ProjectClone.
     * @example
     * // Delete one ProjectClone
     * const ProjectClone = await prisma.projectClone.delete({
     *   where: {
     *     // ... filter to delete one ProjectClone
     *   }
     * })
     * 
    **/
    delete<T extends ProjectCloneDeleteArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectCloneDeleteArgs<ExtArgs>>
    ): Prisma__ProjectCloneClient<$Result.GetResult<Prisma.$ProjectClonePayload<ExtArgs>, T, 'delete'>, never, ExtArgs>

    /**
     * Update one ProjectClone.
     * @param {ProjectCloneUpdateArgs} args - Arguments to update one ProjectClone.
     * @example
     * // Update one ProjectClone
     * const projectClone = await prisma.projectClone.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends ProjectCloneUpdateArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectCloneUpdateArgs<ExtArgs>>
    ): Prisma__ProjectCloneClient<$Result.GetResult<Prisma.$ProjectClonePayload<ExtArgs>, T, 'update'>, never, ExtArgs>

    /**
     * Delete zero or more ProjectClones.
     * @param {ProjectCloneDeleteManyArgs} args - Arguments to filter ProjectClones to delete.
     * @example
     * // Delete a few ProjectClones
     * const { count } = await prisma.projectClone.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends ProjectCloneDeleteManyArgs<ExtArgs>>(
      args?: SelectSubset<T, ProjectCloneDeleteManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more ProjectClones.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectCloneUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many ProjectClones
     * const projectClone = await prisma.projectClone.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends ProjectCloneUpdateManyArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectCloneUpdateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one ProjectClone.
     * @param {ProjectCloneUpsertArgs} args - Arguments to update or create a ProjectClone.
     * @example
     * // Update or create a ProjectClone
     * const projectClone = await prisma.projectClone.upsert({
     *   create: {
     *     // ... data to create a ProjectClone
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the ProjectClone we want to update
     *   }
     * })
    **/
    upsert<T extends ProjectCloneUpsertArgs<ExtArgs>>(
      args: SelectSubset<T, ProjectCloneUpsertArgs<ExtArgs>>
    ): Prisma__ProjectCloneClient<$Result.GetResult<Prisma.$ProjectClonePayload<ExtArgs>, T, 'upsert'>, never, ExtArgs>

    /**
     * Count the number of ProjectClones.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectCloneCountArgs} args - Arguments to filter ProjectClones to count.
     * @example
     * // Count the number of ProjectClones
     * const count = await prisma.projectClone.count({
     *   where: {
     *     // ... the filter for the ProjectClones we want to count
     *   }
     * })
    **/
    count<T extends ProjectCloneCountArgs>(
      args?: Subset<T, ProjectCloneCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], ProjectCloneCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a ProjectClone.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectCloneAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends ProjectCloneAggregateArgs>(args: Subset<T, ProjectCloneAggregateArgs>): Prisma.PrismaPromise<GetProjectCloneAggregateType<T>>

    /**
     * Group by ProjectClone.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {ProjectCloneGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends ProjectCloneGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: ProjectCloneGroupByArgs['orderBy'] }
        : { orderBy?: ProjectCloneGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, ProjectCloneGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetProjectCloneGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the ProjectClone model
   */
  readonly fields: ProjectCloneFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for ProjectClone.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__ProjectCloneClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: 'PrismaPromise';

    asset<T extends MarketplaceAssetDefaultArgs<ExtArgs> = {}>(args?: Subset<T, MarketplaceAssetDefaultArgs<ExtArgs>>): Prisma__MarketplaceAssetClient<$Result.GetResult<Prisma.$MarketplaceAssetPayload<ExtArgs>, T, 'findUniqueOrThrow'> | Null, Null, ExtArgs>;

    clonedProject<T extends ProjectDefaultArgs<ExtArgs> = {}>(args?: Subset<T, ProjectDefaultArgs<ExtArgs>>): Prisma__ProjectClient<$Result.GetResult<Prisma.$ProjectPayload<ExtArgs>, T, 'findUniqueOrThrow'> | Null, Null, ExtArgs>;

    clonedBy<T extends UserDefaultArgs<ExtArgs> = {}>(args?: Subset<T, UserDefaultArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, 'findUniqueOrThrow'> | Null, Null, ExtArgs>;

    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>;
  }



  /**
   * Fields of the ProjectClone model
   */ 
  interface ProjectCloneFieldRefs {
    readonly id: FieldRef<"ProjectClone", 'String'>
    readonly sourceAssetId: FieldRef<"ProjectClone", 'String'>
    readonly clonedProjectId: FieldRef<"ProjectClone", 'String'>
    readonly clonedByUserId: FieldRef<"ProjectClone", 'String'>
    readonly createdAt: FieldRef<"ProjectClone", 'DateTime'>
  }
    

  // Custom InputTypes

  /**
   * ProjectClone findUnique
   */
  export type ProjectCloneFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectClone
     */
    select?: ProjectCloneSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectCloneInclude<ExtArgs> | null
    /**
     * Filter, which ProjectClone to fetch.
     */
    where: ProjectCloneWhereUniqueInput
  }


  /**
   * ProjectClone findUniqueOrThrow
   */
  export type ProjectCloneFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectClone
     */
    select?: ProjectCloneSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectCloneInclude<ExtArgs> | null
    /**
     * Filter, which ProjectClone to fetch.
     */
    where: ProjectCloneWhereUniqueInput
  }


  /**
   * ProjectClone findFirst
   */
  export type ProjectCloneFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectClone
     */
    select?: ProjectCloneSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectCloneInclude<ExtArgs> | null
    /**
     * Filter, which ProjectClone to fetch.
     */
    where?: ProjectCloneWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ProjectClones to fetch.
     */
    orderBy?: ProjectCloneOrderByWithRelationInput | ProjectCloneOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ProjectClones.
     */
    cursor?: ProjectCloneWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ProjectClones from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ProjectClones.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ProjectClones.
     */
    distinct?: ProjectCloneScalarFieldEnum | ProjectCloneScalarFieldEnum[]
  }


  /**
   * ProjectClone findFirstOrThrow
   */
  export type ProjectCloneFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectClone
     */
    select?: ProjectCloneSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectCloneInclude<ExtArgs> | null
    /**
     * Filter, which ProjectClone to fetch.
     */
    where?: ProjectCloneWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ProjectClones to fetch.
     */
    orderBy?: ProjectCloneOrderByWithRelationInput | ProjectCloneOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for ProjectClones.
     */
    cursor?: ProjectCloneWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ProjectClones from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ProjectClones.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of ProjectClones.
     */
    distinct?: ProjectCloneScalarFieldEnum | ProjectCloneScalarFieldEnum[]
  }


  /**
   * ProjectClone findMany
   */
  export type ProjectCloneFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectClone
     */
    select?: ProjectCloneSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectCloneInclude<ExtArgs> | null
    /**
     * Filter, which ProjectClones to fetch.
     */
    where?: ProjectCloneWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of ProjectClones to fetch.
     */
    orderBy?: ProjectCloneOrderByWithRelationInput | ProjectCloneOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing ProjectClones.
     */
    cursor?: ProjectCloneWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` ProjectClones from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` ProjectClones.
     */
    skip?: number
    distinct?: ProjectCloneScalarFieldEnum | ProjectCloneScalarFieldEnum[]
  }


  /**
   * ProjectClone create
   */
  export type ProjectCloneCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectClone
     */
    select?: ProjectCloneSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectCloneInclude<ExtArgs> | null
    /**
     * The data needed to create a ProjectClone.
     */
    data: XOR<ProjectCloneCreateInput, ProjectCloneUncheckedCreateInput>
  }


  /**
   * ProjectClone createMany
   */
  export type ProjectCloneCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many ProjectClones.
     */
    data: ProjectCloneCreateManyInput | ProjectCloneCreateManyInput[]
    skipDuplicates?: boolean
  }


  /**
   * ProjectClone update
   */
  export type ProjectCloneUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectClone
     */
    select?: ProjectCloneSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectCloneInclude<ExtArgs> | null
    /**
     * The data needed to update a ProjectClone.
     */
    data: XOR<ProjectCloneUpdateInput, ProjectCloneUncheckedUpdateInput>
    /**
     * Choose, which ProjectClone to update.
     */
    where: ProjectCloneWhereUniqueInput
  }


  /**
   * ProjectClone updateMany
   */
  export type ProjectCloneUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update ProjectClones.
     */
    data: XOR<ProjectCloneUpdateManyMutationInput, ProjectCloneUncheckedUpdateManyInput>
    /**
     * Filter which ProjectClones to update
     */
    where?: ProjectCloneWhereInput
  }


  /**
   * ProjectClone upsert
   */
  export type ProjectCloneUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectClone
     */
    select?: ProjectCloneSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectCloneInclude<ExtArgs> | null
    /**
     * The filter to search for the ProjectClone to update in case it exists.
     */
    where: ProjectCloneWhereUniqueInput
    /**
     * In case the ProjectClone found by the `where` argument doesn't exist, create a new ProjectClone with this data.
     */
    create: XOR<ProjectCloneCreateInput, ProjectCloneUncheckedCreateInput>
    /**
     * In case the ProjectClone was found with the provided `where` argument, update it with this data.
     */
    update: XOR<ProjectCloneUpdateInput, ProjectCloneUncheckedUpdateInput>
  }


  /**
   * ProjectClone delete
   */
  export type ProjectCloneDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectClone
     */
    select?: ProjectCloneSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectCloneInclude<ExtArgs> | null
    /**
     * Filter which ProjectClone to delete.
     */
    where: ProjectCloneWhereUniqueInput
  }


  /**
   * ProjectClone deleteMany
   */
  export type ProjectCloneDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which ProjectClones to delete
     */
    where?: ProjectCloneWhereInput
  }


  /**
   * ProjectClone without action
   */
  export type ProjectCloneDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the ProjectClone
     */
    select?: ProjectCloneSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well.
     */
    include?: ProjectCloneInclude<ExtArgs> | null
  }



  /**
   * Model EarlyAccessApplication
   */

  export type AggregateEarlyAccessApplication = {
    _count: EarlyAccessApplicationCountAggregateOutputType | null
    _avg: EarlyAccessApplicationAvgAggregateOutputType | null
    _sum: EarlyAccessApplicationSumAggregateOutputType | null
    _min: EarlyAccessApplicationMinAggregateOutputType | null
    _max: EarlyAccessApplicationMaxAggregateOutputType | null
  }

  export type EarlyAccessApplicationAvgAggregateOutputType = {
    teamSize: number | null
  }

  export type EarlyAccessApplicationSumAggregateOutputType = {
    teamSize: number | null
  }

  export type EarlyAccessApplicationMinAggregateOutputType = {
    id: string | null
    orgName: string | null
    contactName: string | null
    contactEmail: string | null
    domain: string | null
    useCase: string | null
    teamSize: number | null
    status: $Enums.OrgStatus | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type EarlyAccessApplicationMaxAggregateOutputType = {
    id: string | null
    orgName: string | null
    contactName: string | null
    contactEmail: string | null
    domain: string | null
    useCase: string | null
    teamSize: number | null
    status: $Enums.OrgStatus | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type EarlyAccessApplicationCountAggregateOutputType = {
    id: number
    orgName: number
    contactName: number
    contactEmail: number
    domain: number
    useCase: number
    teamSize: number
    status: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type EarlyAccessApplicationAvgAggregateInputType = {
    teamSize?: true
  }

  export type EarlyAccessApplicationSumAggregateInputType = {
    teamSize?: true
  }

  export type EarlyAccessApplicationMinAggregateInputType = {
    id?: true
    orgName?: true
    contactName?: true
    contactEmail?: true
    domain?: true
    useCase?: true
    teamSize?: true
    status?: true
    createdAt?: true
    updatedAt?: true
  }

  export type EarlyAccessApplicationMaxAggregateInputType = {
    id?: true
    orgName?: true
    contactName?: true
    contactEmail?: true
    domain?: true
    useCase?: true
    teamSize?: true
    status?: true
    createdAt?: true
    updatedAt?: true
  }

  export type EarlyAccessApplicationCountAggregateInputType = {
    id?: true
    orgName?: true
    contactName?: true
    contactEmail?: true
    domain?: true
    useCase?: true
    teamSize?: true
    status?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type EarlyAccessApplicationAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which EarlyAccessApplication to aggregate.
     */
    where?: EarlyAccessApplicationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of EarlyAccessApplications to fetch.
     */
    orderBy?: EarlyAccessApplicationOrderByWithRelationInput | EarlyAccessApplicationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: EarlyAccessApplicationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` EarlyAccessApplications from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` EarlyAccessApplications.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned EarlyAccessApplications
    **/
    _count?: true | EarlyAccessApplicationCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: EarlyAccessApplicationAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: EarlyAccessApplicationSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: EarlyAccessApplicationMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: EarlyAccessApplicationMaxAggregateInputType
  }

  export type GetEarlyAccessApplicationAggregateType<T extends EarlyAccessApplicationAggregateArgs> = {
        [P in keyof T & keyof AggregateEarlyAccessApplication]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateEarlyAccessApplication[P]>
      : GetScalarType<T[P], AggregateEarlyAccessApplication[P]>
  }




  export type EarlyAccessApplicationGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: EarlyAccessApplicationWhereInput
    orderBy?: EarlyAccessApplicationOrderByWithAggregationInput | EarlyAccessApplicationOrderByWithAggregationInput[]
    by: EarlyAccessApplicationScalarFieldEnum[] | EarlyAccessApplicationScalarFieldEnum
    having?: EarlyAccessApplicationScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: EarlyAccessApplicationCountAggregateInputType | true
    _avg?: EarlyAccessApplicationAvgAggregateInputType
    _sum?: EarlyAccessApplicationSumAggregateInputType
    _min?: EarlyAccessApplicationMinAggregateInputType
    _max?: EarlyAccessApplicationMaxAggregateInputType
  }

  export type EarlyAccessApplicationGroupByOutputType = {
    id: string
    orgName: string
    contactName: string
    contactEmail: string
    domain: string | null
    useCase: string
    teamSize: number
    status: $Enums.OrgStatus
    createdAt: Date
    updatedAt: Date
    _count: EarlyAccessApplicationCountAggregateOutputType | null
    _avg: EarlyAccessApplicationAvgAggregateOutputType | null
    _sum: EarlyAccessApplicationSumAggregateOutputType | null
    _min: EarlyAccessApplicationMinAggregateOutputType | null
    _max: EarlyAccessApplicationMaxAggregateOutputType | null
  }

  type GetEarlyAccessApplicationGroupByPayload<T extends EarlyAccessApplicationGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<EarlyAccessApplicationGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof EarlyAccessApplicationGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], EarlyAccessApplicationGroupByOutputType[P]>
            : GetScalarType<T[P], EarlyAccessApplicationGroupByOutputType[P]>
        }
      >
    >


  export type EarlyAccessApplicationSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    orgName?: boolean
    contactName?: boolean
    contactEmail?: boolean
    domain?: boolean
    useCase?: boolean
    teamSize?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["earlyAccessApplication"]>

  export type EarlyAccessApplicationSelectScalar = {
    id?: boolean
    orgName?: boolean
    contactName?: boolean
    contactEmail?: boolean
    domain?: boolean
    useCase?: boolean
    teamSize?: boolean
    status?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $EarlyAccessApplicationPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "EarlyAccessApplication"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      orgName: string
      contactName: string
      contactEmail: string
      domain: string | null
      useCase: string
      teamSize: number
      status: $Enums.OrgStatus
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["earlyAccessApplication"]>
    composites: {}
  }


  type EarlyAccessApplicationGetPayload<S extends boolean | null | undefined | EarlyAccessApplicationDefaultArgs> = $Result.GetResult<Prisma.$EarlyAccessApplicationPayload, S>

  type EarlyAccessApplicationCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<EarlyAccessApplicationFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: EarlyAccessApplicationCountAggregateInputType | true
    }

  export interface EarlyAccessApplicationDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['EarlyAccessApplication'], meta: { name: 'EarlyAccessApplication' } }
    /**
     * Find zero or one EarlyAccessApplication that matches the filter.
     * @param {EarlyAccessApplicationFindUniqueArgs} args - Arguments to find a EarlyAccessApplication
     * @example
     * // Get one EarlyAccessApplication
     * const earlyAccessApplication = await prisma.earlyAccessApplication.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends EarlyAccessApplicationFindUniqueArgs<ExtArgs>>(
      args: SelectSubset<T, EarlyAccessApplicationFindUniqueArgs<ExtArgs>>
    ): Prisma__EarlyAccessApplicationClient<$Result.GetResult<Prisma.$EarlyAccessApplicationPayload<ExtArgs>, T, 'findUnique'> | null, null, ExtArgs>

    /**
     * Find one EarlyAccessApplication that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {EarlyAccessApplicationFindUniqueOrThrowArgs} args - Arguments to find a EarlyAccessApplication
     * @example
     * // Get one EarlyAccessApplication
     * const earlyAccessApplication = await prisma.earlyAccessApplication.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends EarlyAccessApplicationFindUniqueOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, EarlyAccessApplicationFindUniqueOrThrowArgs<ExtArgs>>
    ): Prisma__EarlyAccessApplicationClient<$Result.GetResult<Prisma.$EarlyAccessApplicationPayload<ExtArgs>, T, 'findUniqueOrThrow'>, never, ExtArgs>

    /**
     * Find the first EarlyAccessApplication that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {EarlyAccessApplicationFindFirstArgs} args - Arguments to find a EarlyAccessApplication
     * @example
     * // Get one EarlyAccessApplication
     * const earlyAccessApplication = await prisma.earlyAccessApplication.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends EarlyAccessApplicationFindFirstArgs<ExtArgs>>(
      args?: SelectSubset<T, EarlyAccessApplicationFindFirstArgs<ExtArgs>>
    ): Prisma__EarlyAccessApplicationClient<$Result.GetResult<Prisma.$EarlyAccessApplicationPayload<ExtArgs>, T, 'findFirst'> | null, null, ExtArgs>

    /**
     * Find the first EarlyAccessApplication that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {EarlyAccessApplicationFindFirstOrThrowArgs} args - Arguments to find a EarlyAccessApplication
     * @example
     * // Get one EarlyAccessApplication
     * const earlyAccessApplication = await prisma.earlyAccessApplication.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends EarlyAccessApplicationFindFirstOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, EarlyAccessApplicationFindFirstOrThrowArgs<ExtArgs>>
    ): Prisma__EarlyAccessApplicationClient<$Result.GetResult<Prisma.$EarlyAccessApplicationPayload<ExtArgs>, T, 'findFirstOrThrow'>, never, ExtArgs>

    /**
     * Find zero or more EarlyAccessApplications that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {EarlyAccessApplicationFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all EarlyAccessApplications
     * const earlyAccessApplications = await prisma.earlyAccessApplication.findMany()
     * 
     * // Get first 10 EarlyAccessApplications
     * const earlyAccessApplications = await prisma.earlyAccessApplication.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const earlyAccessApplicationWithIdOnly = await prisma.earlyAccessApplication.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends EarlyAccessApplicationFindManyArgs<ExtArgs>>(
      args?: SelectSubset<T, EarlyAccessApplicationFindManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<$Result.GetResult<Prisma.$EarlyAccessApplicationPayload<ExtArgs>, T, 'findMany'>>

    /**
     * Create a EarlyAccessApplication.
     * @param {EarlyAccessApplicationCreateArgs} args - Arguments to create a EarlyAccessApplication.
     * @example
     * // Create one EarlyAccessApplication
     * const EarlyAccessApplication = await prisma.earlyAccessApplication.create({
     *   data: {
     *     // ... data to create a EarlyAccessApplication
     *   }
     * })
     * 
    **/
    create<T extends EarlyAccessApplicationCreateArgs<ExtArgs>>(
      args: SelectSubset<T, EarlyAccessApplicationCreateArgs<ExtArgs>>
    ): Prisma__EarlyAccessApplicationClient<$Result.GetResult<Prisma.$EarlyAccessApplicationPayload<ExtArgs>, T, 'create'>, never, ExtArgs>

    /**
     * Create many EarlyAccessApplications.
     *     @param {EarlyAccessApplicationCreateManyArgs} args - Arguments to create many EarlyAccessApplications.
     *     @example
     *     // Create many EarlyAccessApplications
     *     const earlyAccessApplication = await prisma.earlyAccessApplication.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends EarlyAccessApplicationCreateManyArgs<ExtArgs>>(
      args?: SelectSubset<T, EarlyAccessApplicationCreateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a EarlyAccessApplication.
     * @param {EarlyAccessApplicationDeleteArgs} args - Arguments to delete one EarlyAccessApplication.
     * @example
     * // Delete one EarlyAccessApplication
     * const EarlyAccessApplication = await prisma.earlyAccessApplication.delete({
     *   where: {
     *     // ... filter to delete one EarlyAccessApplication
     *   }
     * })
     * 
    **/
    delete<T extends EarlyAccessApplicationDeleteArgs<ExtArgs>>(
      args: SelectSubset<T, EarlyAccessApplicationDeleteArgs<ExtArgs>>
    ): Prisma__EarlyAccessApplicationClient<$Result.GetResult<Prisma.$EarlyAccessApplicationPayload<ExtArgs>, T, 'delete'>, never, ExtArgs>

    /**
     * Update one EarlyAccessApplication.
     * @param {EarlyAccessApplicationUpdateArgs} args - Arguments to update one EarlyAccessApplication.
     * @example
     * // Update one EarlyAccessApplication
     * const earlyAccessApplication = await prisma.earlyAccessApplication.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends EarlyAccessApplicationUpdateArgs<ExtArgs>>(
      args: SelectSubset<T, EarlyAccessApplicationUpdateArgs<ExtArgs>>
    ): Prisma__EarlyAccessApplicationClient<$Result.GetResult<Prisma.$EarlyAccessApplicationPayload<ExtArgs>, T, 'update'>, never, ExtArgs>

    /**
     * Delete zero or more EarlyAccessApplications.
     * @param {EarlyAccessApplicationDeleteManyArgs} args - Arguments to filter EarlyAccessApplications to delete.
     * @example
     * // Delete a few EarlyAccessApplications
     * const { count } = await prisma.earlyAccessApplication.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends EarlyAccessApplicationDeleteManyArgs<ExtArgs>>(
      args?: SelectSubset<T, EarlyAccessApplicationDeleteManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more EarlyAccessApplications.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {EarlyAccessApplicationUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many EarlyAccessApplications
     * const earlyAccessApplication = await prisma.earlyAccessApplication.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends EarlyAccessApplicationUpdateManyArgs<ExtArgs>>(
      args: SelectSubset<T, EarlyAccessApplicationUpdateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one EarlyAccessApplication.
     * @param {EarlyAccessApplicationUpsertArgs} args - Arguments to update or create a EarlyAccessApplication.
     * @example
     * // Update or create a EarlyAccessApplication
     * const earlyAccessApplication = await prisma.earlyAccessApplication.upsert({
     *   create: {
     *     // ... data to create a EarlyAccessApplication
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the EarlyAccessApplication we want to update
     *   }
     * })
    **/
    upsert<T extends EarlyAccessApplicationUpsertArgs<ExtArgs>>(
      args: SelectSubset<T, EarlyAccessApplicationUpsertArgs<ExtArgs>>
    ): Prisma__EarlyAccessApplicationClient<$Result.GetResult<Prisma.$EarlyAccessApplicationPayload<ExtArgs>, T, 'upsert'>, never, ExtArgs>

    /**
     * Count the number of EarlyAccessApplications.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {EarlyAccessApplicationCountArgs} args - Arguments to filter EarlyAccessApplications to count.
     * @example
     * // Count the number of EarlyAccessApplications
     * const count = await prisma.earlyAccessApplication.count({
     *   where: {
     *     // ... the filter for the EarlyAccessApplications we want to count
     *   }
     * })
    **/
    count<T extends EarlyAccessApplicationCountArgs>(
      args?: Subset<T, EarlyAccessApplicationCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], EarlyAccessApplicationCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a EarlyAccessApplication.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {EarlyAccessApplicationAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends EarlyAccessApplicationAggregateArgs>(args: Subset<T, EarlyAccessApplicationAggregateArgs>): Prisma.PrismaPromise<GetEarlyAccessApplicationAggregateType<T>>

    /**
     * Group by EarlyAccessApplication.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {EarlyAccessApplicationGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends EarlyAccessApplicationGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: EarlyAccessApplicationGroupByArgs['orderBy'] }
        : { orderBy?: EarlyAccessApplicationGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, EarlyAccessApplicationGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetEarlyAccessApplicationGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the EarlyAccessApplication model
   */
  readonly fields: EarlyAccessApplicationFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for EarlyAccessApplication.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__EarlyAccessApplicationClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: 'PrismaPromise';


    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>;
  }



  /**
   * Fields of the EarlyAccessApplication model
   */ 
  interface EarlyAccessApplicationFieldRefs {
    readonly id: FieldRef<"EarlyAccessApplication", 'String'>
    readonly orgName: FieldRef<"EarlyAccessApplication", 'String'>
    readonly contactName: FieldRef<"EarlyAccessApplication", 'String'>
    readonly contactEmail: FieldRef<"EarlyAccessApplication", 'String'>
    readonly domain: FieldRef<"EarlyAccessApplication", 'String'>
    readonly useCase: FieldRef<"EarlyAccessApplication", 'String'>
    readonly teamSize: FieldRef<"EarlyAccessApplication", 'Int'>
    readonly status: FieldRef<"EarlyAccessApplication", 'OrgStatus'>
    readonly createdAt: FieldRef<"EarlyAccessApplication", 'DateTime'>
    readonly updatedAt: FieldRef<"EarlyAccessApplication", 'DateTime'>
  }
    

  // Custom InputTypes

  /**
   * EarlyAccessApplication findUnique
   */
  export type EarlyAccessApplicationFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EarlyAccessApplication
     */
    select?: EarlyAccessApplicationSelect<ExtArgs> | null
    /**
     * Filter, which EarlyAccessApplication to fetch.
     */
    where: EarlyAccessApplicationWhereUniqueInput
  }


  /**
   * EarlyAccessApplication findUniqueOrThrow
   */
  export type EarlyAccessApplicationFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EarlyAccessApplication
     */
    select?: EarlyAccessApplicationSelect<ExtArgs> | null
    /**
     * Filter, which EarlyAccessApplication to fetch.
     */
    where: EarlyAccessApplicationWhereUniqueInput
  }


  /**
   * EarlyAccessApplication findFirst
   */
  export type EarlyAccessApplicationFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EarlyAccessApplication
     */
    select?: EarlyAccessApplicationSelect<ExtArgs> | null
    /**
     * Filter, which EarlyAccessApplication to fetch.
     */
    where?: EarlyAccessApplicationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of EarlyAccessApplications to fetch.
     */
    orderBy?: EarlyAccessApplicationOrderByWithRelationInput | EarlyAccessApplicationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for EarlyAccessApplications.
     */
    cursor?: EarlyAccessApplicationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` EarlyAccessApplications from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` EarlyAccessApplications.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of EarlyAccessApplications.
     */
    distinct?: EarlyAccessApplicationScalarFieldEnum | EarlyAccessApplicationScalarFieldEnum[]
  }


  /**
   * EarlyAccessApplication findFirstOrThrow
   */
  export type EarlyAccessApplicationFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EarlyAccessApplication
     */
    select?: EarlyAccessApplicationSelect<ExtArgs> | null
    /**
     * Filter, which EarlyAccessApplication to fetch.
     */
    where?: EarlyAccessApplicationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of EarlyAccessApplications to fetch.
     */
    orderBy?: EarlyAccessApplicationOrderByWithRelationInput | EarlyAccessApplicationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for EarlyAccessApplications.
     */
    cursor?: EarlyAccessApplicationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` EarlyAccessApplications from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` EarlyAccessApplications.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of EarlyAccessApplications.
     */
    distinct?: EarlyAccessApplicationScalarFieldEnum | EarlyAccessApplicationScalarFieldEnum[]
  }


  /**
   * EarlyAccessApplication findMany
   */
  export type EarlyAccessApplicationFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EarlyAccessApplication
     */
    select?: EarlyAccessApplicationSelect<ExtArgs> | null
    /**
     * Filter, which EarlyAccessApplications to fetch.
     */
    where?: EarlyAccessApplicationWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of EarlyAccessApplications to fetch.
     */
    orderBy?: EarlyAccessApplicationOrderByWithRelationInput | EarlyAccessApplicationOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing EarlyAccessApplications.
     */
    cursor?: EarlyAccessApplicationWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` EarlyAccessApplications from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` EarlyAccessApplications.
     */
    skip?: number
    distinct?: EarlyAccessApplicationScalarFieldEnum | EarlyAccessApplicationScalarFieldEnum[]
  }


  /**
   * EarlyAccessApplication create
   */
  export type EarlyAccessApplicationCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EarlyAccessApplication
     */
    select?: EarlyAccessApplicationSelect<ExtArgs> | null
    /**
     * The data needed to create a EarlyAccessApplication.
     */
    data: XOR<EarlyAccessApplicationCreateInput, EarlyAccessApplicationUncheckedCreateInput>
  }


  /**
   * EarlyAccessApplication createMany
   */
  export type EarlyAccessApplicationCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many EarlyAccessApplications.
     */
    data: EarlyAccessApplicationCreateManyInput | EarlyAccessApplicationCreateManyInput[]
    skipDuplicates?: boolean
  }


  /**
   * EarlyAccessApplication update
   */
  export type EarlyAccessApplicationUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EarlyAccessApplication
     */
    select?: EarlyAccessApplicationSelect<ExtArgs> | null
    /**
     * The data needed to update a EarlyAccessApplication.
     */
    data: XOR<EarlyAccessApplicationUpdateInput, EarlyAccessApplicationUncheckedUpdateInput>
    /**
     * Choose, which EarlyAccessApplication to update.
     */
    where: EarlyAccessApplicationWhereUniqueInput
  }


  /**
   * EarlyAccessApplication updateMany
   */
  export type EarlyAccessApplicationUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update EarlyAccessApplications.
     */
    data: XOR<EarlyAccessApplicationUpdateManyMutationInput, EarlyAccessApplicationUncheckedUpdateManyInput>
    /**
     * Filter which EarlyAccessApplications to update
     */
    where?: EarlyAccessApplicationWhereInput
  }


  /**
   * EarlyAccessApplication upsert
   */
  export type EarlyAccessApplicationUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EarlyAccessApplication
     */
    select?: EarlyAccessApplicationSelect<ExtArgs> | null
    /**
     * The filter to search for the EarlyAccessApplication to update in case it exists.
     */
    where: EarlyAccessApplicationWhereUniqueInput
    /**
     * In case the EarlyAccessApplication found by the `where` argument doesn't exist, create a new EarlyAccessApplication with this data.
     */
    create: XOR<EarlyAccessApplicationCreateInput, EarlyAccessApplicationUncheckedCreateInput>
    /**
     * In case the EarlyAccessApplication was found with the provided `where` argument, update it with this data.
     */
    update: XOR<EarlyAccessApplicationUpdateInput, EarlyAccessApplicationUncheckedUpdateInput>
  }


  /**
   * EarlyAccessApplication delete
   */
  export type EarlyAccessApplicationDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EarlyAccessApplication
     */
    select?: EarlyAccessApplicationSelect<ExtArgs> | null
    /**
     * Filter which EarlyAccessApplication to delete.
     */
    where: EarlyAccessApplicationWhereUniqueInput
  }


  /**
   * EarlyAccessApplication deleteMany
   */
  export type EarlyAccessApplicationDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which EarlyAccessApplications to delete
     */
    where?: EarlyAccessApplicationWhereInput
  }


  /**
   * EarlyAccessApplication without action
   */
  export type EarlyAccessApplicationDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the EarlyAccessApplication
     */
    select?: EarlyAccessApplicationSelect<ExtArgs> | null
  }



  /**
   * Model PasswordResetToken
   */

  export type AggregatePasswordResetToken = {
    _count: PasswordResetTokenCountAggregateOutputType | null
    _min: PasswordResetTokenMinAggregateOutputType | null
    _max: PasswordResetTokenMaxAggregateOutputType | null
  }

  export type PasswordResetTokenMinAggregateOutputType = {
    id: string | null
    token: string | null
    email: string | null
    expiresAt: Date | null
    usedAt: Date | null
    createdAt: Date | null
  }

  export type PasswordResetTokenMaxAggregateOutputType = {
    id: string | null
    token: string | null
    email: string | null
    expiresAt: Date | null
    usedAt: Date | null
    createdAt: Date | null
  }

  export type PasswordResetTokenCountAggregateOutputType = {
    id: number
    token: number
    email: number
    expiresAt: number
    usedAt: number
    createdAt: number
    _all: number
  }


  export type PasswordResetTokenMinAggregateInputType = {
    id?: true
    token?: true
    email?: true
    expiresAt?: true
    usedAt?: true
    createdAt?: true
  }

  export type PasswordResetTokenMaxAggregateInputType = {
    id?: true
    token?: true
    email?: true
    expiresAt?: true
    usedAt?: true
    createdAt?: true
  }

  export type PasswordResetTokenCountAggregateInputType = {
    id?: true
    token?: true
    email?: true
    expiresAt?: true
    usedAt?: true
    createdAt?: true
    _all?: true
  }

  export type PasswordResetTokenAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PasswordResetToken to aggregate.
     */
    where?: PasswordResetTokenWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PasswordResetTokens to fetch.
     */
    orderBy?: PasswordResetTokenOrderByWithRelationInput | PasswordResetTokenOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: PasswordResetTokenWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PasswordResetTokens from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PasswordResetTokens.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned PasswordResetTokens
    **/
    _count?: true | PasswordResetTokenCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: PasswordResetTokenMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: PasswordResetTokenMaxAggregateInputType
  }

  export type GetPasswordResetTokenAggregateType<T extends PasswordResetTokenAggregateArgs> = {
        [P in keyof T & keyof AggregatePasswordResetToken]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePasswordResetToken[P]>
      : GetScalarType<T[P], AggregatePasswordResetToken[P]>
  }




  export type PasswordResetTokenGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: PasswordResetTokenWhereInput
    orderBy?: PasswordResetTokenOrderByWithAggregationInput | PasswordResetTokenOrderByWithAggregationInput[]
    by: PasswordResetTokenScalarFieldEnum[] | PasswordResetTokenScalarFieldEnum
    having?: PasswordResetTokenScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: PasswordResetTokenCountAggregateInputType | true
    _min?: PasswordResetTokenMinAggregateInputType
    _max?: PasswordResetTokenMaxAggregateInputType
  }

  export type PasswordResetTokenGroupByOutputType = {
    id: string
    token: string
    email: string
    expiresAt: Date
    usedAt: Date | null
    createdAt: Date
    _count: PasswordResetTokenCountAggregateOutputType | null
    _min: PasswordResetTokenMinAggregateOutputType | null
    _max: PasswordResetTokenMaxAggregateOutputType | null
  }

  type GetPasswordResetTokenGroupByPayload<T extends PasswordResetTokenGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<PasswordResetTokenGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof PasswordResetTokenGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], PasswordResetTokenGroupByOutputType[P]>
            : GetScalarType<T[P], PasswordResetTokenGroupByOutputType[P]>
        }
      >
    >


  export type PasswordResetTokenSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    token?: boolean
    email?: boolean
    expiresAt?: boolean
    usedAt?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["passwordResetToken"]>

  export type PasswordResetTokenSelectScalar = {
    id?: boolean
    token?: boolean
    email?: boolean
    expiresAt?: boolean
    usedAt?: boolean
    createdAt?: boolean
  }


  export type $PasswordResetTokenPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "PasswordResetToken"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      token: string
      email: string
      expiresAt: Date
      usedAt: Date | null
      createdAt: Date
    }, ExtArgs["result"]["passwordResetToken"]>
    composites: {}
  }


  type PasswordResetTokenGetPayload<S extends boolean | null | undefined | PasswordResetTokenDefaultArgs> = $Result.GetResult<Prisma.$PasswordResetTokenPayload, S>

  type PasswordResetTokenCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<PasswordResetTokenFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: PasswordResetTokenCountAggregateInputType | true
    }

  export interface PasswordResetTokenDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['PasswordResetToken'], meta: { name: 'PasswordResetToken' } }
    /**
     * Find zero or one PasswordResetToken that matches the filter.
     * @param {PasswordResetTokenFindUniqueArgs} args - Arguments to find a PasswordResetToken
     * @example
     * // Get one PasswordResetToken
     * const passwordResetToken = await prisma.passwordResetToken.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUnique<T extends PasswordResetTokenFindUniqueArgs<ExtArgs>>(
      args: SelectSubset<T, PasswordResetTokenFindUniqueArgs<ExtArgs>>
    ): Prisma__PasswordResetTokenClient<$Result.GetResult<Prisma.$PasswordResetTokenPayload<ExtArgs>, T, 'findUnique'> | null, null, ExtArgs>

    /**
     * Find one PasswordResetToken that matches the filter or throw an error  with `error.code='P2025'` 
     *     if no matches were found.
     * @param {PasswordResetTokenFindUniqueOrThrowArgs} args - Arguments to find a PasswordResetToken
     * @example
     * // Get one PasswordResetToken
     * const passwordResetToken = await prisma.passwordResetToken.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findUniqueOrThrow<T extends PasswordResetTokenFindUniqueOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, PasswordResetTokenFindUniqueOrThrowArgs<ExtArgs>>
    ): Prisma__PasswordResetTokenClient<$Result.GetResult<Prisma.$PasswordResetTokenPayload<ExtArgs>, T, 'findUniqueOrThrow'>, never, ExtArgs>

    /**
     * Find the first PasswordResetToken that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PasswordResetTokenFindFirstArgs} args - Arguments to find a PasswordResetToken
     * @example
     * // Get one PasswordResetToken
     * const passwordResetToken = await prisma.passwordResetToken.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirst<T extends PasswordResetTokenFindFirstArgs<ExtArgs>>(
      args?: SelectSubset<T, PasswordResetTokenFindFirstArgs<ExtArgs>>
    ): Prisma__PasswordResetTokenClient<$Result.GetResult<Prisma.$PasswordResetTokenPayload<ExtArgs>, T, 'findFirst'> | null, null, ExtArgs>

    /**
     * Find the first PasswordResetToken that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PasswordResetTokenFindFirstOrThrowArgs} args - Arguments to find a PasswordResetToken
     * @example
     * // Get one PasswordResetToken
     * const passwordResetToken = await prisma.passwordResetToken.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
    **/
    findFirstOrThrow<T extends PasswordResetTokenFindFirstOrThrowArgs<ExtArgs>>(
      args?: SelectSubset<T, PasswordResetTokenFindFirstOrThrowArgs<ExtArgs>>
    ): Prisma__PasswordResetTokenClient<$Result.GetResult<Prisma.$PasswordResetTokenPayload<ExtArgs>, T, 'findFirstOrThrow'>, never, ExtArgs>

    /**
     * Find zero or more PasswordResetTokens that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PasswordResetTokenFindManyArgs=} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all PasswordResetTokens
     * const passwordResetTokens = await prisma.passwordResetToken.findMany()
     * 
     * // Get first 10 PasswordResetTokens
     * const passwordResetTokens = await prisma.passwordResetToken.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const passwordResetTokenWithIdOnly = await prisma.passwordResetToken.findMany({ select: { id: true } })
     * 
    **/
    findMany<T extends PasswordResetTokenFindManyArgs<ExtArgs>>(
      args?: SelectSubset<T, PasswordResetTokenFindManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<$Result.GetResult<Prisma.$PasswordResetTokenPayload<ExtArgs>, T, 'findMany'>>

    /**
     * Create a PasswordResetToken.
     * @param {PasswordResetTokenCreateArgs} args - Arguments to create a PasswordResetToken.
     * @example
     * // Create one PasswordResetToken
     * const PasswordResetToken = await prisma.passwordResetToken.create({
     *   data: {
     *     // ... data to create a PasswordResetToken
     *   }
     * })
     * 
    **/
    create<T extends PasswordResetTokenCreateArgs<ExtArgs>>(
      args: SelectSubset<T, PasswordResetTokenCreateArgs<ExtArgs>>
    ): Prisma__PasswordResetTokenClient<$Result.GetResult<Prisma.$PasswordResetTokenPayload<ExtArgs>, T, 'create'>, never, ExtArgs>

    /**
     * Create many PasswordResetTokens.
     *     @param {PasswordResetTokenCreateManyArgs} args - Arguments to create many PasswordResetTokens.
     *     @example
     *     // Create many PasswordResetTokens
     *     const passwordResetToken = await prisma.passwordResetToken.createMany({
     *       data: {
     *         // ... provide data here
     *       }
     *     })
     *     
    **/
    createMany<T extends PasswordResetTokenCreateManyArgs<ExtArgs>>(
      args?: SelectSubset<T, PasswordResetTokenCreateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Delete a PasswordResetToken.
     * @param {PasswordResetTokenDeleteArgs} args - Arguments to delete one PasswordResetToken.
     * @example
     * // Delete one PasswordResetToken
     * const PasswordResetToken = await prisma.passwordResetToken.delete({
     *   where: {
     *     // ... filter to delete one PasswordResetToken
     *   }
     * })
     * 
    **/
    delete<T extends PasswordResetTokenDeleteArgs<ExtArgs>>(
      args: SelectSubset<T, PasswordResetTokenDeleteArgs<ExtArgs>>
    ): Prisma__PasswordResetTokenClient<$Result.GetResult<Prisma.$PasswordResetTokenPayload<ExtArgs>, T, 'delete'>, never, ExtArgs>

    /**
     * Update one PasswordResetToken.
     * @param {PasswordResetTokenUpdateArgs} args - Arguments to update one PasswordResetToken.
     * @example
     * // Update one PasswordResetToken
     * const passwordResetToken = await prisma.passwordResetToken.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    update<T extends PasswordResetTokenUpdateArgs<ExtArgs>>(
      args: SelectSubset<T, PasswordResetTokenUpdateArgs<ExtArgs>>
    ): Prisma__PasswordResetTokenClient<$Result.GetResult<Prisma.$PasswordResetTokenPayload<ExtArgs>, T, 'update'>, never, ExtArgs>

    /**
     * Delete zero or more PasswordResetTokens.
     * @param {PasswordResetTokenDeleteManyArgs} args - Arguments to filter PasswordResetTokens to delete.
     * @example
     * // Delete a few PasswordResetTokens
     * const { count } = await prisma.passwordResetToken.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
    **/
    deleteMany<T extends PasswordResetTokenDeleteManyArgs<ExtArgs>>(
      args?: SelectSubset<T, PasswordResetTokenDeleteManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more PasswordResetTokens.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PasswordResetTokenUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many PasswordResetTokens
     * const passwordResetToken = await prisma.passwordResetToken.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
    **/
    updateMany<T extends PasswordResetTokenUpdateManyArgs<ExtArgs>>(
      args: SelectSubset<T, PasswordResetTokenUpdateManyArgs<ExtArgs>>
    ): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one PasswordResetToken.
     * @param {PasswordResetTokenUpsertArgs} args - Arguments to update or create a PasswordResetToken.
     * @example
     * // Update or create a PasswordResetToken
     * const passwordResetToken = await prisma.passwordResetToken.upsert({
     *   create: {
     *     // ... data to create a PasswordResetToken
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the PasswordResetToken we want to update
     *   }
     * })
    **/
    upsert<T extends PasswordResetTokenUpsertArgs<ExtArgs>>(
      args: SelectSubset<T, PasswordResetTokenUpsertArgs<ExtArgs>>
    ): Prisma__PasswordResetTokenClient<$Result.GetResult<Prisma.$PasswordResetTokenPayload<ExtArgs>, T, 'upsert'>, never, ExtArgs>

    /**
     * Count the number of PasswordResetTokens.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PasswordResetTokenCountArgs} args - Arguments to filter PasswordResetTokens to count.
     * @example
     * // Count the number of PasswordResetTokens
     * const count = await prisma.passwordResetToken.count({
     *   where: {
     *     // ... the filter for the PasswordResetTokens we want to count
     *   }
     * })
    **/
    count<T extends PasswordResetTokenCountArgs>(
      args?: Subset<T, PasswordResetTokenCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], PasswordResetTokenCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a PasswordResetToken.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PasswordResetTokenAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends PasswordResetTokenAggregateArgs>(args: Subset<T, PasswordResetTokenAggregateArgs>): Prisma.PrismaPromise<GetPasswordResetTokenAggregateType<T>>

    /**
     * Group by PasswordResetToken.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {PasswordResetTokenGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends PasswordResetTokenGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: PasswordResetTokenGroupByArgs['orderBy'] }
        : { orderBy?: PasswordResetTokenGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, PasswordResetTokenGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPasswordResetTokenGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the PasswordResetToken model
   */
  readonly fields: PasswordResetTokenFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for PasswordResetToken.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__PasswordResetTokenClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: 'PrismaPromise';


    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>;
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>;
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>;
  }



  /**
   * Fields of the PasswordResetToken model
   */ 
  interface PasswordResetTokenFieldRefs {
    readonly id: FieldRef<"PasswordResetToken", 'String'>
    readonly token: FieldRef<"PasswordResetToken", 'String'>
    readonly email: FieldRef<"PasswordResetToken", 'String'>
    readonly expiresAt: FieldRef<"PasswordResetToken", 'DateTime'>
    readonly usedAt: FieldRef<"PasswordResetToken", 'DateTime'>
    readonly createdAt: FieldRef<"PasswordResetToken", 'DateTime'>
  }
    

  // Custom InputTypes

  /**
   * PasswordResetToken findUnique
   */
  export type PasswordResetTokenFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PasswordResetToken
     */
    select?: PasswordResetTokenSelect<ExtArgs> | null
    /**
     * Filter, which PasswordResetToken to fetch.
     */
    where: PasswordResetTokenWhereUniqueInput
  }


  /**
   * PasswordResetToken findUniqueOrThrow
   */
  export type PasswordResetTokenFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PasswordResetToken
     */
    select?: PasswordResetTokenSelect<ExtArgs> | null
    /**
     * Filter, which PasswordResetToken to fetch.
     */
    where: PasswordResetTokenWhereUniqueInput
  }


  /**
   * PasswordResetToken findFirst
   */
  export type PasswordResetTokenFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PasswordResetToken
     */
    select?: PasswordResetTokenSelect<ExtArgs> | null
    /**
     * Filter, which PasswordResetToken to fetch.
     */
    where?: PasswordResetTokenWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PasswordResetTokens to fetch.
     */
    orderBy?: PasswordResetTokenOrderByWithRelationInput | PasswordResetTokenOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PasswordResetTokens.
     */
    cursor?: PasswordResetTokenWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PasswordResetTokens from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PasswordResetTokens.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PasswordResetTokens.
     */
    distinct?: PasswordResetTokenScalarFieldEnum | PasswordResetTokenScalarFieldEnum[]
  }


  /**
   * PasswordResetToken findFirstOrThrow
   */
  export type PasswordResetTokenFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PasswordResetToken
     */
    select?: PasswordResetTokenSelect<ExtArgs> | null
    /**
     * Filter, which PasswordResetToken to fetch.
     */
    where?: PasswordResetTokenWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PasswordResetTokens to fetch.
     */
    orderBy?: PasswordResetTokenOrderByWithRelationInput | PasswordResetTokenOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for PasswordResetTokens.
     */
    cursor?: PasswordResetTokenWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PasswordResetTokens from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PasswordResetTokens.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of PasswordResetTokens.
     */
    distinct?: PasswordResetTokenScalarFieldEnum | PasswordResetTokenScalarFieldEnum[]
  }


  /**
   * PasswordResetToken findMany
   */
  export type PasswordResetTokenFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PasswordResetToken
     */
    select?: PasswordResetTokenSelect<ExtArgs> | null
    /**
     * Filter, which PasswordResetTokens to fetch.
     */
    where?: PasswordResetTokenWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of PasswordResetTokens to fetch.
     */
    orderBy?: PasswordResetTokenOrderByWithRelationInput | PasswordResetTokenOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing PasswordResetTokens.
     */
    cursor?: PasswordResetTokenWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` PasswordResetTokens from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` PasswordResetTokens.
     */
    skip?: number
    distinct?: PasswordResetTokenScalarFieldEnum | PasswordResetTokenScalarFieldEnum[]
  }


  /**
   * PasswordResetToken create
   */
  export type PasswordResetTokenCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PasswordResetToken
     */
    select?: PasswordResetTokenSelect<ExtArgs> | null
    /**
     * The data needed to create a PasswordResetToken.
     */
    data: XOR<PasswordResetTokenCreateInput, PasswordResetTokenUncheckedCreateInput>
  }


  /**
   * PasswordResetToken createMany
   */
  export type PasswordResetTokenCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many PasswordResetTokens.
     */
    data: PasswordResetTokenCreateManyInput | PasswordResetTokenCreateManyInput[]
    skipDuplicates?: boolean
  }


  /**
   * PasswordResetToken update
   */
  export type PasswordResetTokenUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PasswordResetToken
     */
    select?: PasswordResetTokenSelect<ExtArgs> | null
    /**
     * The data needed to update a PasswordResetToken.
     */
    data: XOR<PasswordResetTokenUpdateInput, PasswordResetTokenUncheckedUpdateInput>
    /**
     * Choose, which PasswordResetToken to update.
     */
    where: PasswordResetTokenWhereUniqueInput
  }


  /**
   * PasswordResetToken updateMany
   */
  export type PasswordResetTokenUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update PasswordResetTokens.
     */
    data: XOR<PasswordResetTokenUpdateManyMutationInput, PasswordResetTokenUncheckedUpdateManyInput>
    /**
     * Filter which PasswordResetTokens to update
     */
    where?: PasswordResetTokenWhereInput
  }


  /**
   * PasswordResetToken upsert
   */
  export type PasswordResetTokenUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PasswordResetToken
     */
    select?: PasswordResetTokenSelect<ExtArgs> | null
    /**
     * The filter to search for the PasswordResetToken to update in case it exists.
     */
    where: PasswordResetTokenWhereUniqueInput
    /**
     * In case the PasswordResetToken found by the `where` argument doesn't exist, create a new PasswordResetToken with this data.
     */
    create: XOR<PasswordResetTokenCreateInput, PasswordResetTokenUncheckedCreateInput>
    /**
     * In case the PasswordResetToken was found with the provided `where` argument, update it with this data.
     */
    update: XOR<PasswordResetTokenUpdateInput, PasswordResetTokenUncheckedUpdateInput>
  }


  /**
   * PasswordResetToken delete
   */
  export type PasswordResetTokenDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PasswordResetToken
     */
    select?: PasswordResetTokenSelect<ExtArgs> | null
    /**
     * Filter which PasswordResetToken to delete.
     */
    where: PasswordResetTokenWhereUniqueInput
  }


  /**
   * PasswordResetToken deleteMany
   */
  export type PasswordResetTokenDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which PasswordResetTokens to delete
     */
    where?: PasswordResetTokenWhereInput
  }


  /**
   * PasswordResetToken without action
   */
  export type PasswordResetTokenDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the PasswordResetToken
     */
    select?: PasswordResetTokenSelect<ExtArgs> | null
  }



  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const UserScalarFieldEnum: {
    id: 'id',
    name: 'name',
    email: 'email',
    emailVerified: 'emailVerified',
    image: 'image',
    password: 'password',
    bio: 'bio',
    onboardingComplete: 'onboardingComplete',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type UserScalarFieldEnum = (typeof UserScalarFieldEnum)[keyof typeof UserScalarFieldEnum]


  export const OnboardingProgressScalarFieldEnum: {
    userId: 'userId',
    currentStep: 'currentStep',
    selections: 'selections',
    completedAt: 'completedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type OnboardingProgressScalarFieldEnum = (typeof OnboardingProgressScalarFieldEnum)[keyof typeof OnboardingProgressScalarFieldEnum]


  export const OrganizationScalarFieldEnum: {
    id: 'id',
    name: 'name',
    slug: 'slug',
    domain: 'domain',
    logoUrl: 'logoUrl',
    status: 'status',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type OrganizationScalarFieldEnum = (typeof OrganizationScalarFieldEnum)[keyof typeof OrganizationScalarFieldEnum]


  export const OrganizationMemberScalarFieldEnum: {
    id: 'id',
    organizationId: 'organizationId',
    userId: 'userId',
    role: 'role',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type OrganizationMemberScalarFieldEnum = (typeof OrganizationMemberScalarFieldEnum)[keyof typeof OrganizationMemberScalarFieldEnum]


  export const OrganizationInviteTokenScalarFieldEnum: {
    id: 'id',
    organizationId: 'organizationId',
    token: 'token',
    createdByUserId: 'createdByUserId',
    expiresAt: 'expiresAt',
    usedAt: 'usedAt',
    usedByUserId: 'usedByUserId',
    createdAt: 'createdAt'
  };

  export type OrganizationInviteTokenScalarFieldEnum = (typeof OrganizationInviteTokenScalarFieldEnum)[keyof typeof OrganizationInviteTokenScalarFieldEnum]


  export const TeamScalarFieldEnum: {
    id: 'id',
    organizationId: 'organizationId',
    name: 'name',
    description: 'description',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type TeamScalarFieldEnum = (typeof TeamScalarFieldEnum)[keyof typeof TeamScalarFieldEnum]


  export const TeamMemberScalarFieldEnum: {
    id: 'id',
    teamId: 'teamId',
    userId: 'userId',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type TeamMemberScalarFieldEnum = (typeof TeamMemberScalarFieldEnum)[keyof typeof TeamMemberScalarFieldEnum]


  export const ProjectScalarFieldEnum: {
    id: 'id',
    teamId: 'teamId',
    name: 'name',
    description: 'description',
    thumbnailUrl: 'thumbnailUrl',
    stateUrl: 'stateUrl',
    isPublic: 'isPublic',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type ProjectScalarFieldEnum = (typeof ProjectScalarFieldEnum)[keyof typeof ProjectScalarFieldEnum]


  export const ProjectMemberScalarFieldEnum: {
    id: 'id',
    projectId: 'projectId',
    userId: 'userId',
    role: 'role',
    createdAt: 'createdAt'
  };

  export type ProjectMemberScalarFieldEnum = (typeof ProjectMemberScalarFieldEnum)[keyof typeof ProjectMemberScalarFieldEnum]


  export const MarketplaceAssetScalarFieldEnum: {
    id: 'id',
    projectId: 'projectId',
    authorId: 'authorId',
    title: 'title',
    description: 'description',
    tags: 'tags',
    thumbnailUrl: 'thumbnailUrl',
    isPublished: 'isPublished',
    cloneCount: 'cloneCount',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type MarketplaceAssetScalarFieldEnum = (typeof MarketplaceAssetScalarFieldEnum)[keyof typeof MarketplaceAssetScalarFieldEnum]


  export const ProjectCloneScalarFieldEnum: {
    id: 'id',
    sourceAssetId: 'sourceAssetId',
    clonedProjectId: 'clonedProjectId',
    clonedByUserId: 'clonedByUserId',
    createdAt: 'createdAt'
  };

  export type ProjectCloneScalarFieldEnum = (typeof ProjectCloneScalarFieldEnum)[keyof typeof ProjectCloneScalarFieldEnum]


  export const EarlyAccessApplicationScalarFieldEnum: {
    id: 'id',
    orgName: 'orgName',
    contactName: 'contactName',
    contactEmail: 'contactEmail',
    domain: 'domain',
    useCase: 'useCase',
    teamSize: 'teamSize',
    status: 'status',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type EarlyAccessApplicationScalarFieldEnum = (typeof EarlyAccessApplicationScalarFieldEnum)[keyof typeof EarlyAccessApplicationScalarFieldEnum]


  export const PasswordResetTokenScalarFieldEnum: {
    id: 'id',
    token: 'token',
    email: 'email',
    expiresAt: 'expiresAt',
    usedAt: 'usedAt',
    createdAt: 'createdAt'
  };

  export type PasswordResetTokenScalarFieldEnum = (typeof PasswordResetTokenScalarFieldEnum)[keyof typeof PasswordResetTokenScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const JsonNullValueInput: {
    JsonNull: typeof JsonNull
  };

  export type JsonNullValueInput = (typeof JsonNullValueInput)[keyof typeof JsonNullValueInput]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  export const JsonNullValueFilter: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull,
    AnyNull: typeof AnyNull
  };

  export type JsonNullValueFilter = (typeof JsonNullValueFilter)[keyof typeof JsonNullValueFilter]


  /**
   * Field references 
   */


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'String[]'
   */
  export type ListStringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'Json'
   */
  export type JsonFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Json'>
    


  /**
   * Reference to a field of type 'OrgStatus'
   */
  export type EnumOrgStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'OrgStatus'>
    


  /**
   * Reference to a field of type 'OrgStatus[]'
   */
  export type ListEnumOrgStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'OrgStatus[]'>
    


  /**
   * Reference to a field of type 'OrgRole'
   */
  export type EnumOrgRoleFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'OrgRole'>
    


  /**
   * Reference to a field of type 'OrgRole[]'
   */
  export type ListEnumOrgRoleFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'OrgRole[]'>
    


  /**
   * Reference to a field of type 'ProjectRole'
   */
  export type EnumProjectRoleFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'ProjectRole'>
    


  /**
   * Reference to a field of type 'ProjectRole[]'
   */
  export type ListEnumProjectRoleFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'ProjectRole[]'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    
  /**
   * Deep Input Types
   */


  export type UserWhereInput = {
    AND?: UserWhereInput | UserWhereInput[]
    OR?: UserWhereInput[]
    NOT?: UserWhereInput | UserWhereInput[]
    id?: StringFilter<"User"> | string
    name?: StringNullableFilter<"User"> | string | null
    email?: StringNullableFilter<"User"> | string | null
    emailVerified?: DateTimeNullableFilter<"User"> | Date | string | null
    image?: StringNullableFilter<"User"> | string | null
    password?: StringNullableFilter<"User"> | string | null
    bio?: StringNullableFilter<"User"> | string | null
    onboardingComplete?: BoolFilter<"User"> | boolean
    createdAt?: DateTimeFilter<"User"> | Date | string
    updatedAt?: DateTimeFilter<"User"> | Date | string
    onboardingProgress?: XOR<OnboardingProgressNullableRelationFilter, OnboardingProgressWhereInput> | null
    organizations?: OrganizationMemberListRelationFilter
    teamMemberships?: TeamMemberListRelationFilter
    projectMemberships?: ProjectMemberListRelationFilter
    publishedAssets?: MarketplaceAssetListRelationFilter
    clonedProjects?: ProjectCloneListRelationFilter
  }

  export type UserOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrderInput | SortOrder
    email?: SortOrderInput | SortOrder
    emailVerified?: SortOrderInput | SortOrder
    image?: SortOrderInput | SortOrder
    password?: SortOrderInput | SortOrder
    bio?: SortOrderInput | SortOrder
    onboardingComplete?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    onboardingProgress?: OnboardingProgressOrderByWithRelationInput
    organizations?: OrganizationMemberOrderByRelationAggregateInput
    teamMemberships?: TeamMemberOrderByRelationAggregateInput
    projectMemberships?: ProjectMemberOrderByRelationAggregateInput
    publishedAssets?: MarketplaceAssetOrderByRelationAggregateInput
    clonedProjects?: ProjectCloneOrderByRelationAggregateInput
  }

  export type UserWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    email?: string
    AND?: UserWhereInput | UserWhereInput[]
    OR?: UserWhereInput[]
    NOT?: UserWhereInput | UserWhereInput[]
    name?: StringNullableFilter<"User"> | string | null
    emailVerified?: DateTimeNullableFilter<"User"> | Date | string | null
    image?: StringNullableFilter<"User"> | string | null
    password?: StringNullableFilter<"User"> | string | null
    bio?: StringNullableFilter<"User"> | string | null
    onboardingComplete?: BoolFilter<"User"> | boolean
    createdAt?: DateTimeFilter<"User"> | Date | string
    updatedAt?: DateTimeFilter<"User"> | Date | string
    onboardingProgress?: XOR<OnboardingProgressNullableRelationFilter, OnboardingProgressWhereInput> | null
    organizations?: OrganizationMemberListRelationFilter
    teamMemberships?: TeamMemberListRelationFilter
    projectMemberships?: ProjectMemberListRelationFilter
    publishedAssets?: MarketplaceAssetListRelationFilter
    clonedProjects?: ProjectCloneListRelationFilter
  }, "id" | "email">

  export type UserOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrderInput | SortOrder
    email?: SortOrderInput | SortOrder
    emailVerified?: SortOrderInput | SortOrder
    image?: SortOrderInput | SortOrder
    password?: SortOrderInput | SortOrder
    bio?: SortOrderInput | SortOrder
    onboardingComplete?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: UserCountOrderByAggregateInput
    _max?: UserMaxOrderByAggregateInput
    _min?: UserMinOrderByAggregateInput
  }

  export type UserScalarWhereWithAggregatesInput = {
    AND?: UserScalarWhereWithAggregatesInput | UserScalarWhereWithAggregatesInput[]
    OR?: UserScalarWhereWithAggregatesInput[]
    NOT?: UserScalarWhereWithAggregatesInput | UserScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"User"> | string
    name?: StringNullableWithAggregatesFilter<"User"> | string | null
    email?: StringNullableWithAggregatesFilter<"User"> | string | null
    emailVerified?: DateTimeNullableWithAggregatesFilter<"User"> | Date | string | null
    image?: StringNullableWithAggregatesFilter<"User"> | string | null
    password?: StringNullableWithAggregatesFilter<"User"> | string | null
    bio?: StringNullableWithAggregatesFilter<"User"> | string | null
    onboardingComplete?: BoolWithAggregatesFilter<"User"> | boolean
    createdAt?: DateTimeWithAggregatesFilter<"User"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"User"> | Date | string
  }

  export type OnboardingProgressWhereInput = {
    AND?: OnboardingProgressWhereInput | OnboardingProgressWhereInput[]
    OR?: OnboardingProgressWhereInput[]
    NOT?: OnboardingProgressWhereInput | OnboardingProgressWhereInput[]
    userId?: StringFilter<"OnboardingProgress"> | string
    currentStep?: IntFilter<"OnboardingProgress"> | number
    selections?: JsonFilter<"OnboardingProgress">
    completedAt?: DateTimeNullableFilter<"OnboardingProgress"> | Date | string | null
    createdAt?: DateTimeFilter<"OnboardingProgress"> | Date | string
    updatedAt?: DateTimeFilter<"OnboardingProgress"> | Date | string
    user?: XOR<UserRelationFilter, UserWhereInput>
  }

  export type OnboardingProgressOrderByWithRelationInput = {
    userId?: SortOrder
    currentStep?: SortOrder
    selections?: SortOrder
    completedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    user?: UserOrderByWithRelationInput
  }

  export type OnboardingProgressWhereUniqueInput = Prisma.AtLeast<{
    userId?: string
    AND?: OnboardingProgressWhereInput | OnboardingProgressWhereInput[]
    OR?: OnboardingProgressWhereInput[]
    NOT?: OnboardingProgressWhereInput | OnboardingProgressWhereInput[]
    currentStep?: IntFilter<"OnboardingProgress"> | number
    selections?: JsonFilter<"OnboardingProgress">
    completedAt?: DateTimeNullableFilter<"OnboardingProgress"> | Date | string | null
    createdAt?: DateTimeFilter<"OnboardingProgress"> | Date | string
    updatedAt?: DateTimeFilter<"OnboardingProgress"> | Date | string
    user?: XOR<UserRelationFilter, UserWhereInput>
  }, "userId">

  export type OnboardingProgressOrderByWithAggregationInput = {
    userId?: SortOrder
    currentStep?: SortOrder
    selections?: SortOrder
    completedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: OnboardingProgressCountOrderByAggregateInput
    _avg?: OnboardingProgressAvgOrderByAggregateInput
    _max?: OnboardingProgressMaxOrderByAggregateInput
    _min?: OnboardingProgressMinOrderByAggregateInput
    _sum?: OnboardingProgressSumOrderByAggregateInput
  }

  export type OnboardingProgressScalarWhereWithAggregatesInput = {
    AND?: OnboardingProgressScalarWhereWithAggregatesInput | OnboardingProgressScalarWhereWithAggregatesInput[]
    OR?: OnboardingProgressScalarWhereWithAggregatesInput[]
    NOT?: OnboardingProgressScalarWhereWithAggregatesInput | OnboardingProgressScalarWhereWithAggregatesInput[]
    userId?: StringWithAggregatesFilter<"OnboardingProgress"> | string
    currentStep?: IntWithAggregatesFilter<"OnboardingProgress"> | number
    selections?: JsonWithAggregatesFilter<"OnboardingProgress">
    completedAt?: DateTimeNullableWithAggregatesFilter<"OnboardingProgress"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"OnboardingProgress"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"OnboardingProgress"> | Date | string
  }

  export type OrganizationWhereInput = {
    AND?: OrganizationWhereInput | OrganizationWhereInput[]
    OR?: OrganizationWhereInput[]
    NOT?: OrganizationWhereInput | OrganizationWhereInput[]
    id?: StringFilter<"Organization"> | string
    name?: StringFilter<"Organization"> | string
    slug?: StringFilter<"Organization"> | string
    domain?: StringNullableFilter<"Organization"> | string | null
    logoUrl?: StringNullableFilter<"Organization"> | string | null
    status?: EnumOrgStatusFilter<"Organization"> | $Enums.OrgStatus
    createdAt?: DateTimeFilter<"Organization"> | Date | string
    updatedAt?: DateTimeFilter<"Organization"> | Date | string
    members?: OrganizationMemberListRelationFilter
    teams?: TeamListRelationFilter
    inviteTokens?: OrganizationInviteTokenListRelationFilter
  }

  export type OrganizationOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    slug?: SortOrder
    domain?: SortOrderInput | SortOrder
    logoUrl?: SortOrderInput | SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    members?: OrganizationMemberOrderByRelationAggregateInput
    teams?: TeamOrderByRelationAggregateInput
    inviteTokens?: OrganizationInviteTokenOrderByRelationAggregateInput
  }

  export type OrganizationWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    slug?: string
    domain?: string
    AND?: OrganizationWhereInput | OrganizationWhereInput[]
    OR?: OrganizationWhereInput[]
    NOT?: OrganizationWhereInput | OrganizationWhereInput[]
    name?: StringFilter<"Organization"> | string
    logoUrl?: StringNullableFilter<"Organization"> | string | null
    status?: EnumOrgStatusFilter<"Organization"> | $Enums.OrgStatus
    createdAt?: DateTimeFilter<"Organization"> | Date | string
    updatedAt?: DateTimeFilter<"Organization"> | Date | string
    members?: OrganizationMemberListRelationFilter
    teams?: TeamListRelationFilter
    inviteTokens?: OrganizationInviteTokenListRelationFilter
  }, "id" | "slug" | "domain">

  export type OrganizationOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    slug?: SortOrder
    domain?: SortOrderInput | SortOrder
    logoUrl?: SortOrderInput | SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: OrganizationCountOrderByAggregateInput
    _max?: OrganizationMaxOrderByAggregateInput
    _min?: OrganizationMinOrderByAggregateInput
  }

  export type OrganizationScalarWhereWithAggregatesInput = {
    AND?: OrganizationScalarWhereWithAggregatesInput | OrganizationScalarWhereWithAggregatesInput[]
    OR?: OrganizationScalarWhereWithAggregatesInput[]
    NOT?: OrganizationScalarWhereWithAggregatesInput | OrganizationScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Organization"> | string
    name?: StringWithAggregatesFilter<"Organization"> | string
    slug?: StringWithAggregatesFilter<"Organization"> | string
    domain?: StringNullableWithAggregatesFilter<"Organization"> | string | null
    logoUrl?: StringNullableWithAggregatesFilter<"Organization"> | string | null
    status?: EnumOrgStatusWithAggregatesFilter<"Organization"> | $Enums.OrgStatus
    createdAt?: DateTimeWithAggregatesFilter<"Organization"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Organization"> | Date | string
  }

  export type OrganizationMemberWhereInput = {
    AND?: OrganizationMemberWhereInput | OrganizationMemberWhereInput[]
    OR?: OrganizationMemberWhereInput[]
    NOT?: OrganizationMemberWhereInput | OrganizationMemberWhereInput[]
    id?: StringFilter<"OrganizationMember"> | string
    organizationId?: StringFilter<"OrganizationMember"> | string
    userId?: StringFilter<"OrganizationMember"> | string
    role?: EnumOrgRoleFilter<"OrganizationMember"> | $Enums.OrgRole
    createdAt?: DateTimeFilter<"OrganizationMember"> | Date | string
    updatedAt?: DateTimeFilter<"OrganizationMember"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    user?: XOR<UserRelationFilter, UserWhereInput>
  }

  export type OrganizationMemberOrderByWithRelationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    userId?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    organization?: OrganizationOrderByWithRelationInput
    user?: UserOrderByWithRelationInput
  }

  export type OrganizationMemberWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    organizationId_userId?: OrganizationMemberOrganizationIdUserIdCompoundUniqueInput
    AND?: OrganizationMemberWhereInput | OrganizationMemberWhereInput[]
    OR?: OrganizationMemberWhereInput[]
    NOT?: OrganizationMemberWhereInput | OrganizationMemberWhereInput[]
    organizationId?: StringFilter<"OrganizationMember"> | string
    userId?: StringFilter<"OrganizationMember"> | string
    role?: EnumOrgRoleFilter<"OrganizationMember"> | $Enums.OrgRole
    createdAt?: DateTimeFilter<"OrganizationMember"> | Date | string
    updatedAt?: DateTimeFilter<"OrganizationMember"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    user?: XOR<UserRelationFilter, UserWhereInput>
  }, "id" | "organizationId_userId">

  export type OrganizationMemberOrderByWithAggregationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    userId?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: OrganizationMemberCountOrderByAggregateInput
    _max?: OrganizationMemberMaxOrderByAggregateInput
    _min?: OrganizationMemberMinOrderByAggregateInput
  }

  export type OrganizationMemberScalarWhereWithAggregatesInput = {
    AND?: OrganizationMemberScalarWhereWithAggregatesInput | OrganizationMemberScalarWhereWithAggregatesInput[]
    OR?: OrganizationMemberScalarWhereWithAggregatesInput[]
    NOT?: OrganizationMemberScalarWhereWithAggregatesInput | OrganizationMemberScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"OrganizationMember"> | string
    organizationId?: StringWithAggregatesFilter<"OrganizationMember"> | string
    userId?: StringWithAggregatesFilter<"OrganizationMember"> | string
    role?: EnumOrgRoleWithAggregatesFilter<"OrganizationMember"> | $Enums.OrgRole
    createdAt?: DateTimeWithAggregatesFilter<"OrganizationMember"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"OrganizationMember"> | Date | string
  }

  export type OrganizationInviteTokenWhereInput = {
    AND?: OrganizationInviteTokenWhereInput | OrganizationInviteTokenWhereInput[]
    OR?: OrganizationInviteTokenWhereInput[]
    NOT?: OrganizationInviteTokenWhereInput | OrganizationInviteTokenWhereInput[]
    id?: StringFilter<"OrganizationInviteToken"> | string
    organizationId?: StringFilter<"OrganizationInviteToken"> | string
    token?: StringFilter<"OrganizationInviteToken"> | string
    createdByUserId?: StringFilter<"OrganizationInviteToken"> | string
    expiresAt?: DateTimeFilter<"OrganizationInviteToken"> | Date | string
    usedAt?: DateTimeNullableFilter<"OrganizationInviteToken"> | Date | string | null
    usedByUserId?: StringNullableFilter<"OrganizationInviteToken"> | string | null
    createdAt?: DateTimeFilter<"OrganizationInviteToken"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
  }

  export type OrganizationInviteTokenOrderByWithRelationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    token?: SortOrder
    createdByUserId?: SortOrder
    expiresAt?: SortOrder
    usedAt?: SortOrderInput | SortOrder
    usedByUserId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    organization?: OrganizationOrderByWithRelationInput
  }

  export type OrganizationInviteTokenWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    token?: string
    AND?: OrganizationInviteTokenWhereInput | OrganizationInviteTokenWhereInput[]
    OR?: OrganizationInviteTokenWhereInput[]
    NOT?: OrganizationInviteTokenWhereInput | OrganizationInviteTokenWhereInput[]
    organizationId?: StringFilter<"OrganizationInviteToken"> | string
    createdByUserId?: StringFilter<"OrganizationInviteToken"> | string
    expiresAt?: DateTimeFilter<"OrganizationInviteToken"> | Date | string
    usedAt?: DateTimeNullableFilter<"OrganizationInviteToken"> | Date | string | null
    usedByUserId?: StringNullableFilter<"OrganizationInviteToken"> | string | null
    createdAt?: DateTimeFilter<"OrganizationInviteToken"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
  }, "id" | "token">

  export type OrganizationInviteTokenOrderByWithAggregationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    token?: SortOrder
    createdByUserId?: SortOrder
    expiresAt?: SortOrder
    usedAt?: SortOrderInput | SortOrder
    usedByUserId?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: OrganizationInviteTokenCountOrderByAggregateInput
    _max?: OrganizationInviteTokenMaxOrderByAggregateInput
    _min?: OrganizationInviteTokenMinOrderByAggregateInput
  }

  export type OrganizationInviteTokenScalarWhereWithAggregatesInput = {
    AND?: OrganizationInviteTokenScalarWhereWithAggregatesInput | OrganizationInviteTokenScalarWhereWithAggregatesInput[]
    OR?: OrganizationInviteTokenScalarWhereWithAggregatesInput[]
    NOT?: OrganizationInviteTokenScalarWhereWithAggregatesInput | OrganizationInviteTokenScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"OrganizationInviteToken"> | string
    organizationId?: StringWithAggregatesFilter<"OrganizationInviteToken"> | string
    token?: StringWithAggregatesFilter<"OrganizationInviteToken"> | string
    createdByUserId?: StringWithAggregatesFilter<"OrganizationInviteToken"> | string
    expiresAt?: DateTimeWithAggregatesFilter<"OrganizationInviteToken"> | Date | string
    usedAt?: DateTimeNullableWithAggregatesFilter<"OrganizationInviteToken"> | Date | string | null
    usedByUserId?: StringNullableWithAggregatesFilter<"OrganizationInviteToken"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"OrganizationInviteToken"> | Date | string
  }

  export type TeamWhereInput = {
    AND?: TeamWhereInput | TeamWhereInput[]
    OR?: TeamWhereInput[]
    NOT?: TeamWhereInput | TeamWhereInput[]
    id?: StringFilter<"Team"> | string
    organizationId?: StringFilter<"Team"> | string
    name?: StringFilter<"Team"> | string
    description?: StringNullableFilter<"Team"> | string | null
    createdAt?: DateTimeFilter<"Team"> | Date | string
    updatedAt?: DateTimeFilter<"Team"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    members?: TeamMemberListRelationFilter
    projects?: ProjectListRelationFilter
  }

  export type TeamOrderByWithRelationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    organization?: OrganizationOrderByWithRelationInput
    members?: TeamMemberOrderByRelationAggregateInput
    projects?: ProjectOrderByRelationAggregateInput
  }

  export type TeamWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: TeamWhereInput | TeamWhereInput[]
    OR?: TeamWhereInput[]
    NOT?: TeamWhereInput | TeamWhereInput[]
    organizationId?: StringFilter<"Team"> | string
    name?: StringFilter<"Team"> | string
    description?: StringNullableFilter<"Team"> | string | null
    createdAt?: DateTimeFilter<"Team"> | Date | string
    updatedAt?: DateTimeFilter<"Team"> | Date | string
    organization?: XOR<OrganizationRelationFilter, OrganizationWhereInput>
    members?: TeamMemberListRelationFilter
    projects?: ProjectListRelationFilter
  }, "id">

  export type TeamOrderByWithAggregationInput = {
    id?: SortOrder
    organizationId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: TeamCountOrderByAggregateInput
    _max?: TeamMaxOrderByAggregateInput
    _min?: TeamMinOrderByAggregateInput
  }

  export type TeamScalarWhereWithAggregatesInput = {
    AND?: TeamScalarWhereWithAggregatesInput | TeamScalarWhereWithAggregatesInput[]
    OR?: TeamScalarWhereWithAggregatesInput[]
    NOT?: TeamScalarWhereWithAggregatesInput | TeamScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Team"> | string
    organizationId?: StringWithAggregatesFilter<"Team"> | string
    name?: StringWithAggregatesFilter<"Team"> | string
    description?: StringNullableWithAggregatesFilter<"Team"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Team"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Team"> | Date | string
  }

  export type TeamMemberWhereInput = {
    AND?: TeamMemberWhereInput | TeamMemberWhereInput[]
    OR?: TeamMemberWhereInput[]
    NOT?: TeamMemberWhereInput | TeamMemberWhereInput[]
    id?: StringFilter<"TeamMember"> | string
    teamId?: StringFilter<"TeamMember"> | string
    userId?: StringFilter<"TeamMember"> | string
    createdAt?: DateTimeFilter<"TeamMember"> | Date | string
    updatedAt?: DateTimeFilter<"TeamMember"> | Date | string
    team?: XOR<TeamRelationFilter, TeamWhereInput>
    user?: XOR<UserRelationFilter, UserWhereInput>
  }

  export type TeamMemberOrderByWithRelationInput = {
    id?: SortOrder
    teamId?: SortOrder
    userId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    team?: TeamOrderByWithRelationInput
    user?: UserOrderByWithRelationInput
  }

  export type TeamMemberWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    teamId_userId?: TeamMemberTeamIdUserIdCompoundUniqueInput
    AND?: TeamMemberWhereInput | TeamMemberWhereInput[]
    OR?: TeamMemberWhereInput[]
    NOT?: TeamMemberWhereInput | TeamMemberWhereInput[]
    teamId?: StringFilter<"TeamMember"> | string
    userId?: StringFilter<"TeamMember"> | string
    createdAt?: DateTimeFilter<"TeamMember"> | Date | string
    updatedAt?: DateTimeFilter<"TeamMember"> | Date | string
    team?: XOR<TeamRelationFilter, TeamWhereInput>
    user?: XOR<UserRelationFilter, UserWhereInput>
  }, "id" | "teamId_userId">

  export type TeamMemberOrderByWithAggregationInput = {
    id?: SortOrder
    teamId?: SortOrder
    userId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: TeamMemberCountOrderByAggregateInput
    _max?: TeamMemberMaxOrderByAggregateInput
    _min?: TeamMemberMinOrderByAggregateInput
  }

  export type TeamMemberScalarWhereWithAggregatesInput = {
    AND?: TeamMemberScalarWhereWithAggregatesInput | TeamMemberScalarWhereWithAggregatesInput[]
    OR?: TeamMemberScalarWhereWithAggregatesInput[]
    NOT?: TeamMemberScalarWhereWithAggregatesInput | TeamMemberScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"TeamMember"> | string
    teamId?: StringWithAggregatesFilter<"TeamMember"> | string
    userId?: StringWithAggregatesFilter<"TeamMember"> | string
    createdAt?: DateTimeWithAggregatesFilter<"TeamMember"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"TeamMember"> | Date | string
  }

  export type ProjectWhereInput = {
    AND?: ProjectWhereInput | ProjectWhereInput[]
    OR?: ProjectWhereInput[]
    NOT?: ProjectWhereInput | ProjectWhereInput[]
    id?: StringFilter<"Project"> | string
    teamId?: StringFilter<"Project"> | string
    name?: StringFilter<"Project"> | string
    description?: StringNullableFilter<"Project"> | string | null
    thumbnailUrl?: StringNullableFilter<"Project"> | string | null
    stateUrl?: StringNullableFilter<"Project"> | string | null
    isPublic?: BoolFilter<"Project"> | boolean
    createdAt?: DateTimeFilter<"Project"> | Date | string
    updatedAt?: DateTimeFilter<"Project"> | Date | string
    team?: XOR<TeamRelationFilter, TeamWhereInput>
    members?: ProjectMemberListRelationFilter
    publishedAsset?: XOR<MarketplaceAssetNullableRelationFilter, MarketplaceAssetWhereInput> | null
    clonedFrom?: XOR<ProjectCloneNullableRelationFilter, ProjectCloneWhereInput> | null
  }

  export type ProjectOrderByWithRelationInput = {
    id?: SortOrder
    teamId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    thumbnailUrl?: SortOrderInput | SortOrder
    stateUrl?: SortOrderInput | SortOrder
    isPublic?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    team?: TeamOrderByWithRelationInput
    members?: ProjectMemberOrderByRelationAggregateInput
    publishedAsset?: MarketplaceAssetOrderByWithRelationInput
    clonedFrom?: ProjectCloneOrderByWithRelationInput
  }

  export type ProjectWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: ProjectWhereInput | ProjectWhereInput[]
    OR?: ProjectWhereInput[]
    NOT?: ProjectWhereInput | ProjectWhereInput[]
    teamId?: StringFilter<"Project"> | string
    name?: StringFilter<"Project"> | string
    description?: StringNullableFilter<"Project"> | string | null
    thumbnailUrl?: StringNullableFilter<"Project"> | string | null
    stateUrl?: StringNullableFilter<"Project"> | string | null
    isPublic?: BoolFilter<"Project"> | boolean
    createdAt?: DateTimeFilter<"Project"> | Date | string
    updatedAt?: DateTimeFilter<"Project"> | Date | string
    team?: XOR<TeamRelationFilter, TeamWhereInput>
    members?: ProjectMemberListRelationFilter
    publishedAsset?: XOR<MarketplaceAssetNullableRelationFilter, MarketplaceAssetWhereInput> | null
    clonedFrom?: XOR<ProjectCloneNullableRelationFilter, ProjectCloneWhereInput> | null
  }, "id">

  export type ProjectOrderByWithAggregationInput = {
    id?: SortOrder
    teamId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    thumbnailUrl?: SortOrderInput | SortOrder
    stateUrl?: SortOrderInput | SortOrder
    isPublic?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: ProjectCountOrderByAggregateInput
    _max?: ProjectMaxOrderByAggregateInput
    _min?: ProjectMinOrderByAggregateInput
  }

  export type ProjectScalarWhereWithAggregatesInput = {
    AND?: ProjectScalarWhereWithAggregatesInput | ProjectScalarWhereWithAggregatesInput[]
    OR?: ProjectScalarWhereWithAggregatesInput[]
    NOT?: ProjectScalarWhereWithAggregatesInput | ProjectScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Project"> | string
    teamId?: StringWithAggregatesFilter<"Project"> | string
    name?: StringWithAggregatesFilter<"Project"> | string
    description?: StringNullableWithAggregatesFilter<"Project"> | string | null
    thumbnailUrl?: StringNullableWithAggregatesFilter<"Project"> | string | null
    stateUrl?: StringNullableWithAggregatesFilter<"Project"> | string | null
    isPublic?: BoolWithAggregatesFilter<"Project"> | boolean
    createdAt?: DateTimeWithAggregatesFilter<"Project"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Project"> | Date | string
  }

  export type ProjectMemberWhereInput = {
    AND?: ProjectMemberWhereInput | ProjectMemberWhereInput[]
    OR?: ProjectMemberWhereInput[]
    NOT?: ProjectMemberWhereInput | ProjectMemberWhereInput[]
    id?: StringFilter<"ProjectMember"> | string
    projectId?: StringFilter<"ProjectMember"> | string
    userId?: StringFilter<"ProjectMember"> | string
    role?: EnumProjectRoleFilter<"ProjectMember"> | $Enums.ProjectRole
    createdAt?: DateTimeFilter<"ProjectMember"> | Date | string
    project?: XOR<ProjectRelationFilter, ProjectWhereInput>
    user?: XOR<UserRelationFilter, UserWhereInput>
  }

  export type ProjectMemberOrderByWithRelationInput = {
    id?: SortOrder
    projectId?: SortOrder
    userId?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    project?: ProjectOrderByWithRelationInput
    user?: UserOrderByWithRelationInput
  }

  export type ProjectMemberWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    projectId_userId?: ProjectMemberProjectIdUserIdCompoundUniqueInput
    AND?: ProjectMemberWhereInput | ProjectMemberWhereInput[]
    OR?: ProjectMemberWhereInput[]
    NOT?: ProjectMemberWhereInput | ProjectMemberWhereInput[]
    projectId?: StringFilter<"ProjectMember"> | string
    userId?: StringFilter<"ProjectMember"> | string
    role?: EnumProjectRoleFilter<"ProjectMember"> | $Enums.ProjectRole
    createdAt?: DateTimeFilter<"ProjectMember"> | Date | string
    project?: XOR<ProjectRelationFilter, ProjectWhereInput>
    user?: XOR<UserRelationFilter, UserWhereInput>
  }, "id" | "projectId_userId">

  export type ProjectMemberOrderByWithAggregationInput = {
    id?: SortOrder
    projectId?: SortOrder
    userId?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    _count?: ProjectMemberCountOrderByAggregateInput
    _max?: ProjectMemberMaxOrderByAggregateInput
    _min?: ProjectMemberMinOrderByAggregateInput
  }

  export type ProjectMemberScalarWhereWithAggregatesInput = {
    AND?: ProjectMemberScalarWhereWithAggregatesInput | ProjectMemberScalarWhereWithAggregatesInput[]
    OR?: ProjectMemberScalarWhereWithAggregatesInput[]
    NOT?: ProjectMemberScalarWhereWithAggregatesInput | ProjectMemberScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"ProjectMember"> | string
    projectId?: StringWithAggregatesFilter<"ProjectMember"> | string
    userId?: StringWithAggregatesFilter<"ProjectMember"> | string
    role?: EnumProjectRoleWithAggregatesFilter<"ProjectMember"> | $Enums.ProjectRole
    createdAt?: DateTimeWithAggregatesFilter<"ProjectMember"> | Date | string
  }

  export type MarketplaceAssetWhereInput = {
    AND?: MarketplaceAssetWhereInput | MarketplaceAssetWhereInput[]
    OR?: MarketplaceAssetWhereInput[]
    NOT?: MarketplaceAssetWhereInput | MarketplaceAssetWhereInput[]
    id?: StringFilter<"MarketplaceAsset"> | string
    projectId?: StringFilter<"MarketplaceAsset"> | string
    authorId?: StringFilter<"MarketplaceAsset"> | string
    title?: StringFilter<"MarketplaceAsset"> | string
    description?: StringNullableFilter<"MarketplaceAsset"> | string | null
    tags?: StringNullableListFilter<"MarketplaceAsset">
    thumbnailUrl?: StringNullableFilter<"MarketplaceAsset"> | string | null
    isPublished?: BoolFilter<"MarketplaceAsset"> | boolean
    cloneCount?: IntFilter<"MarketplaceAsset"> | number
    createdAt?: DateTimeFilter<"MarketplaceAsset"> | Date | string
    updatedAt?: DateTimeFilter<"MarketplaceAsset"> | Date | string
    project?: XOR<ProjectRelationFilter, ProjectWhereInput>
    author?: XOR<UserRelationFilter, UserWhereInput>
    clones?: ProjectCloneListRelationFilter
  }

  export type MarketplaceAssetOrderByWithRelationInput = {
    id?: SortOrder
    projectId?: SortOrder
    authorId?: SortOrder
    title?: SortOrder
    description?: SortOrderInput | SortOrder
    tags?: SortOrder
    thumbnailUrl?: SortOrderInput | SortOrder
    isPublished?: SortOrder
    cloneCount?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    project?: ProjectOrderByWithRelationInput
    author?: UserOrderByWithRelationInput
    clones?: ProjectCloneOrderByRelationAggregateInput
  }

  export type MarketplaceAssetWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    projectId?: string
    AND?: MarketplaceAssetWhereInput | MarketplaceAssetWhereInput[]
    OR?: MarketplaceAssetWhereInput[]
    NOT?: MarketplaceAssetWhereInput | MarketplaceAssetWhereInput[]
    authorId?: StringFilter<"MarketplaceAsset"> | string
    title?: StringFilter<"MarketplaceAsset"> | string
    description?: StringNullableFilter<"MarketplaceAsset"> | string | null
    tags?: StringNullableListFilter<"MarketplaceAsset">
    thumbnailUrl?: StringNullableFilter<"MarketplaceAsset"> | string | null
    isPublished?: BoolFilter<"MarketplaceAsset"> | boolean
    cloneCount?: IntFilter<"MarketplaceAsset"> | number
    createdAt?: DateTimeFilter<"MarketplaceAsset"> | Date | string
    updatedAt?: DateTimeFilter<"MarketplaceAsset"> | Date | string
    project?: XOR<ProjectRelationFilter, ProjectWhereInput>
    author?: XOR<UserRelationFilter, UserWhereInput>
    clones?: ProjectCloneListRelationFilter
  }, "id" | "projectId">

  export type MarketplaceAssetOrderByWithAggregationInput = {
    id?: SortOrder
    projectId?: SortOrder
    authorId?: SortOrder
    title?: SortOrder
    description?: SortOrderInput | SortOrder
    tags?: SortOrder
    thumbnailUrl?: SortOrderInput | SortOrder
    isPublished?: SortOrder
    cloneCount?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: MarketplaceAssetCountOrderByAggregateInput
    _avg?: MarketplaceAssetAvgOrderByAggregateInput
    _max?: MarketplaceAssetMaxOrderByAggregateInput
    _min?: MarketplaceAssetMinOrderByAggregateInput
    _sum?: MarketplaceAssetSumOrderByAggregateInput
  }

  export type MarketplaceAssetScalarWhereWithAggregatesInput = {
    AND?: MarketplaceAssetScalarWhereWithAggregatesInput | MarketplaceAssetScalarWhereWithAggregatesInput[]
    OR?: MarketplaceAssetScalarWhereWithAggregatesInput[]
    NOT?: MarketplaceAssetScalarWhereWithAggregatesInput | MarketplaceAssetScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"MarketplaceAsset"> | string
    projectId?: StringWithAggregatesFilter<"MarketplaceAsset"> | string
    authorId?: StringWithAggregatesFilter<"MarketplaceAsset"> | string
    title?: StringWithAggregatesFilter<"MarketplaceAsset"> | string
    description?: StringNullableWithAggregatesFilter<"MarketplaceAsset"> | string | null
    tags?: StringNullableListFilter<"MarketplaceAsset">
    thumbnailUrl?: StringNullableWithAggregatesFilter<"MarketplaceAsset"> | string | null
    isPublished?: BoolWithAggregatesFilter<"MarketplaceAsset"> | boolean
    cloneCount?: IntWithAggregatesFilter<"MarketplaceAsset"> | number
    createdAt?: DateTimeWithAggregatesFilter<"MarketplaceAsset"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"MarketplaceAsset"> | Date | string
  }

  export type ProjectCloneWhereInput = {
    AND?: ProjectCloneWhereInput | ProjectCloneWhereInput[]
    OR?: ProjectCloneWhereInput[]
    NOT?: ProjectCloneWhereInput | ProjectCloneWhereInput[]
    id?: StringFilter<"ProjectClone"> | string
    sourceAssetId?: StringFilter<"ProjectClone"> | string
    clonedProjectId?: StringFilter<"ProjectClone"> | string
    clonedByUserId?: StringFilter<"ProjectClone"> | string
    createdAt?: DateTimeFilter<"ProjectClone"> | Date | string
    asset?: XOR<MarketplaceAssetRelationFilter, MarketplaceAssetWhereInput>
    clonedProject?: XOR<ProjectRelationFilter, ProjectWhereInput>
    clonedBy?: XOR<UserRelationFilter, UserWhereInput>
  }

  export type ProjectCloneOrderByWithRelationInput = {
    id?: SortOrder
    sourceAssetId?: SortOrder
    clonedProjectId?: SortOrder
    clonedByUserId?: SortOrder
    createdAt?: SortOrder
    asset?: MarketplaceAssetOrderByWithRelationInput
    clonedProject?: ProjectOrderByWithRelationInput
    clonedBy?: UserOrderByWithRelationInput
  }

  export type ProjectCloneWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    clonedProjectId?: string
    AND?: ProjectCloneWhereInput | ProjectCloneWhereInput[]
    OR?: ProjectCloneWhereInput[]
    NOT?: ProjectCloneWhereInput | ProjectCloneWhereInput[]
    sourceAssetId?: StringFilter<"ProjectClone"> | string
    clonedByUserId?: StringFilter<"ProjectClone"> | string
    createdAt?: DateTimeFilter<"ProjectClone"> | Date | string
    asset?: XOR<MarketplaceAssetRelationFilter, MarketplaceAssetWhereInput>
    clonedProject?: XOR<ProjectRelationFilter, ProjectWhereInput>
    clonedBy?: XOR<UserRelationFilter, UserWhereInput>
  }, "id" | "clonedProjectId">

  export type ProjectCloneOrderByWithAggregationInput = {
    id?: SortOrder
    sourceAssetId?: SortOrder
    clonedProjectId?: SortOrder
    clonedByUserId?: SortOrder
    createdAt?: SortOrder
    _count?: ProjectCloneCountOrderByAggregateInput
    _max?: ProjectCloneMaxOrderByAggregateInput
    _min?: ProjectCloneMinOrderByAggregateInput
  }

  export type ProjectCloneScalarWhereWithAggregatesInput = {
    AND?: ProjectCloneScalarWhereWithAggregatesInput | ProjectCloneScalarWhereWithAggregatesInput[]
    OR?: ProjectCloneScalarWhereWithAggregatesInput[]
    NOT?: ProjectCloneScalarWhereWithAggregatesInput | ProjectCloneScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"ProjectClone"> | string
    sourceAssetId?: StringWithAggregatesFilter<"ProjectClone"> | string
    clonedProjectId?: StringWithAggregatesFilter<"ProjectClone"> | string
    clonedByUserId?: StringWithAggregatesFilter<"ProjectClone"> | string
    createdAt?: DateTimeWithAggregatesFilter<"ProjectClone"> | Date | string
  }

  export type EarlyAccessApplicationWhereInput = {
    AND?: EarlyAccessApplicationWhereInput | EarlyAccessApplicationWhereInput[]
    OR?: EarlyAccessApplicationWhereInput[]
    NOT?: EarlyAccessApplicationWhereInput | EarlyAccessApplicationWhereInput[]
    id?: StringFilter<"EarlyAccessApplication"> | string
    orgName?: StringFilter<"EarlyAccessApplication"> | string
    contactName?: StringFilter<"EarlyAccessApplication"> | string
    contactEmail?: StringFilter<"EarlyAccessApplication"> | string
    domain?: StringNullableFilter<"EarlyAccessApplication"> | string | null
    useCase?: StringFilter<"EarlyAccessApplication"> | string
    teamSize?: IntFilter<"EarlyAccessApplication"> | number
    status?: EnumOrgStatusFilter<"EarlyAccessApplication"> | $Enums.OrgStatus
    createdAt?: DateTimeFilter<"EarlyAccessApplication"> | Date | string
    updatedAt?: DateTimeFilter<"EarlyAccessApplication"> | Date | string
  }

  export type EarlyAccessApplicationOrderByWithRelationInput = {
    id?: SortOrder
    orgName?: SortOrder
    contactName?: SortOrder
    contactEmail?: SortOrder
    domain?: SortOrderInput | SortOrder
    useCase?: SortOrder
    teamSize?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type EarlyAccessApplicationWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: EarlyAccessApplicationWhereInput | EarlyAccessApplicationWhereInput[]
    OR?: EarlyAccessApplicationWhereInput[]
    NOT?: EarlyAccessApplicationWhereInput | EarlyAccessApplicationWhereInput[]
    orgName?: StringFilter<"EarlyAccessApplication"> | string
    contactName?: StringFilter<"EarlyAccessApplication"> | string
    contactEmail?: StringFilter<"EarlyAccessApplication"> | string
    domain?: StringNullableFilter<"EarlyAccessApplication"> | string | null
    useCase?: StringFilter<"EarlyAccessApplication"> | string
    teamSize?: IntFilter<"EarlyAccessApplication"> | number
    status?: EnumOrgStatusFilter<"EarlyAccessApplication"> | $Enums.OrgStatus
    createdAt?: DateTimeFilter<"EarlyAccessApplication"> | Date | string
    updatedAt?: DateTimeFilter<"EarlyAccessApplication"> | Date | string
  }, "id">

  export type EarlyAccessApplicationOrderByWithAggregationInput = {
    id?: SortOrder
    orgName?: SortOrder
    contactName?: SortOrder
    contactEmail?: SortOrder
    domain?: SortOrderInput | SortOrder
    useCase?: SortOrder
    teamSize?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: EarlyAccessApplicationCountOrderByAggregateInput
    _avg?: EarlyAccessApplicationAvgOrderByAggregateInput
    _max?: EarlyAccessApplicationMaxOrderByAggregateInput
    _min?: EarlyAccessApplicationMinOrderByAggregateInput
    _sum?: EarlyAccessApplicationSumOrderByAggregateInput
  }

  export type EarlyAccessApplicationScalarWhereWithAggregatesInput = {
    AND?: EarlyAccessApplicationScalarWhereWithAggregatesInput | EarlyAccessApplicationScalarWhereWithAggregatesInput[]
    OR?: EarlyAccessApplicationScalarWhereWithAggregatesInput[]
    NOT?: EarlyAccessApplicationScalarWhereWithAggregatesInput | EarlyAccessApplicationScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"EarlyAccessApplication"> | string
    orgName?: StringWithAggregatesFilter<"EarlyAccessApplication"> | string
    contactName?: StringWithAggregatesFilter<"EarlyAccessApplication"> | string
    contactEmail?: StringWithAggregatesFilter<"EarlyAccessApplication"> | string
    domain?: StringNullableWithAggregatesFilter<"EarlyAccessApplication"> | string | null
    useCase?: StringWithAggregatesFilter<"EarlyAccessApplication"> | string
    teamSize?: IntWithAggregatesFilter<"EarlyAccessApplication"> | number
    status?: EnumOrgStatusWithAggregatesFilter<"EarlyAccessApplication"> | $Enums.OrgStatus
    createdAt?: DateTimeWithAggregatesFilter<"EarlyAccessApplication"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"EarlyAccessApplication"> | Date | string
  }

  export type PasswordResetTokenWhereInput = {
    AND?: PasswordResetTokenWhereInput | PasswordResetTokenWhereInput[]
    OR?: PasswordResetTokenWhereInput[]
    NOT?: PasswordResetTokenWhereInput | PasswordResetTokenWhereInput[]
    id?: StringFilter<"PasswordResetToken"> | string
    token?: StringFilter<"PasswordResetToken"> | string
    email?: StringFilter<"PasswordResetToken"> | string
    expiresAt?: DateTimeFilter<"PasswordResetToken"> | Date | string
    usedAt?: DateTimeNullableFilter<"PasswordResetToken"> | Date | string | null
    createdAt?: DateTimeFilter<"PasswordResetToken"> | Date | string
  }

  export type PasswordResetTokenOrderByWithRelationInput = {
    id?: SortOrder
    token?: SortOrder
    email?: SortOrder
    expiresAt?: SortOrder
    usedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
  }

  export type PasswordResetTokenWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    token?: string
    AND?: PasswordResetTokenWhereInput | PasswordResetTokenWhereInput[]
    OR?: PasswordResetTokenWhereInput[]
    NOT?: PasswordResetTokenWhereInput | PasswordResetTokenWhereInput[]
    email?: StringFilter<"PasswordResetToken"> | string
    expiresAt?: DateTimeFilter<"PasswordResetToken"> | Date | string
    usedAt?: DateTimeNullableFilter<"PasswordResetToken"> | Date | string | null
    createdAt?: DateTimeFilter<"PasswordResetToken"> | Date | string
  }, "id" | "token">

  export type PasswordResetTokenOrderByWithAggregationInput = {
    id?: SortOrder
    token?: SortOrder
    email?: SortOrder
    expiresAt?: SortOrder
    usedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: PasswordResetTokenCountOrderByAggregateInput
    _max?: PasswordResetTokenMaxOrderByAggregateInput
    _min?: PasswordResetTokenMinOrderByAggregateInput
  }

  export type PasswordResetTokenScalarWhereWithAggregatesInput = {
    AND?: PasswordResetTokenScalarWhereWithAggregatesInput | PasswordResetTokenScalarWhereWithAggregatesInput[]
    OR?: PasswordResetTokenScalarWhereWithAggregatesInput[]
    NOT?: PasswordResetTokenScalarWhereWithAggregatesInput | PasswordResetTokenScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"PasswordResetToken"> | string
    token?: StringWithAggregatesFilter<"PasswordResetToken"> | string
    email?: StringWithAggregatesFilter<"PasswordResetToken"> | string
    expiresAt?: DateTimeWithAggregatesFilter<"PasswordResetToken"> | Date | string
    usedAt?: DateTimeNullableWithAggregatesFilter<"PasswordResetToken"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"PasswordResetToken"> | Date | string
  }

  export type UserCreateInput = {
    id?: string
    name?: string | null
    email?: string | null
    emailVerified?: Date | string | null
    image?: string | null
    password?: string | null
    bio?: string | null
    onboardingComplete?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    onboardingProgress?: OnboardingProgressCreateNestedOneWithoutUserInput
    organizations?: OrganizationMemberCreateNestedManyWithoutUserInput
    teamMemberships?: TeamMemberCreateNestedManyWithoutUserInput
    projectMemberships?: ProjectMemberCreateNestedManyWithoutUserInput
    publishedAssets?: MarketplaceAssetCreateNestedManyWithoutAuthorInput
    clonedProjects?: ProjectCloneCreateNestedManyWithoutClonedByInput
  }

  export type UserUncheckedCreateInput = {
    id?: string
    name?: string | null
    email?: string | null
    emailVerified?: Date | string | null
    image?: string | null
    password?: string | null
    bio?: string | null
    onboardingComplete?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    onboardingProgress?: OnboardingProgressUncheckedCreateNestedOneWithoutUserInput
    organizations?: OrganizationMemberUncheckedCreateNestedManyWithoutUserInput
    teamMemberships?: TeamMemberUncheckedCreateNestedManyWithoutUserInput
    projectMemberships?: ProjectMemberUncheckedCreateNestedManyWithoutUserInput
    publishedAssets?: MarketplaceAssetUncheckedCreateNestedManyWithoutAuthorInput
    clonedProjects?: ProjectCloneUncheckedCreateNestedManyWithoutClonedByInput
  }

  export type UserUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    onboardingProgress?: OnboardingProgressUpdateOneWithoutUserNestedInput
    organizations?: OrganizationMemberUpdateManyWithoutUserNestedInput
    teamMemberships?: TeamMemberUpdateManyWithoutUserNestedInput
    projectMemberships?: ProjectMemberUpdateManyWithoutUserNestedInput
    publishedAssets?: MarketplaceAssetUpdateManyWithoutAuthorNestedInput
    clonedProjects?: ProjectCloneUpdateManyWithoutClonedByNestedInput
  }

  export type UserUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    onboardingProgress?: OnboardingProgressUncheckedUpdateOneWithoutUserNestedInput
    organizations?: OrganizationMemberUncheckedUpdateManyWithoutUserNestedInput
    teamMemberships?: TeamMemberUncheckedUpdateManyWithoutUserNestedInput
    projectMemberships?: ProjectMemberUncheckedUpdateManyWithoutUserNestedInput
    publishedAssets?: MarketplaceAssetUncheckedUpdateManyWithoutAuthorNestedInput
    clonedProjects?: ProjectCloneUncheckedUpdateManyWithoutClonedByNestedInput
  }

  export type UserCreateManyInput = {
    id?: string
    name?: string | null
    email?: string | null
    emailVerified?: Date | string | null
    image?: string | null
    password?: string | null
    bio?: string | null
    onboardingComplete?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OnboardingProgressCreateInput = {
    currentStep?: number
    selections?: JsonNullValueInput | InputJsonValue
    completedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    user: UserCreateNestedOneWithoutOnboardingProgressInput
  }

  export type OnboardingProgressUncheckedCreateInput = {
    userId: string
    currentStep?: number
    selections?: JsonNullValueInput | InputJsonValue
    completedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type OnboardingProgressUpdateInput = {
    currentStep?: IntFieldUpdateOperationsInput | number
    selections?: JsonNullValueInput | InputJsonValue
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    user?: UserUpdateOneRequiredWithoutOnboardingProgressNestedInput
  }

  export type OnboardingProgressUncheckedUpdateInput = {
    userId?: StringFieldUpdateOperationsInput | string
    currentStep?: IntFieldUpdateOperationsInput | number
    selections?: JsonNullValueInput | InputJsonValue
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OnboardingProgressCreateManyInput = {
    userId: string
    currentStep?: number
    selections?: JsonNullValueInput | InputJsonValue
    completedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type OnboardingProgressUpdateManyMutationInput = {
    currentStep?: IntFieldUpdateOperationsInput | number
    selections?: JsonNullValueInput | InputJsonValue
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OnboardingProgressUncheckedUpdateManyInput = {
    userId?: StringFieldUpdateOperationsInput | string
    currentStep?: IntFieldUpdateOperationsInput | number
    selections?: JsonNullValueInput | InputJsonValue
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationCreateInput = {
    id?: string
    name: string
    slug: string
    domain?: string | null
    logoUrl?: string | null
    status?: $Enums.OrgStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    members?: OrganizationMemberCreateNestedManyWithoutOrganizationInput
    teams?: TeamCreateNestedManyWithoutOrganizationInput
    inviteTokens?: OrganizationInviteTokenCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationUncheckedCreateInput = {
    id?: string
    name: string
    slug: string
    domain?: string | null
    logoUrl?: string | null
    status?: $Enums.OrgStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    members?: OrganizationMemberUncheckedCreateNestedManyWithoutOrganizationInput
    teams?: TeamUncheckedCreateNestedManyWithoutOrganizationInput
    inviteTokens?: OrganizationInviteTokenUncheckedCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    domain?: NullableStringFieldUpdateOperationsInput | string | null
    logoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumOrgStatusFieldUpdateOperationsInput | $Enums.OrgStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: OrganizationMemberUpdateManyWithoutOrganizationNestedInput
    teams?: TeamUpdateManyWithoutOrganizationNestedInput
    inviteTokens?: OrganizationInviteTokenUpdateManyWithoutOrganizationNestedInput
  }

  export type OrganizationUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    domain?: NullableStringFieldUpdateOperationsInput | string | null
    logoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumOrgStatusFieldUpdateOperationsInput | $Enums.OrgStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: OrganizationMemberUncheckedUpdateManyWithoutOrganizationNestedInput
    teams?: TeamUncheckedUpdateManyWithoutOrganizationNestedInput
    inviteTokens?: OrganizationInviteTokenUncheckedUpdateManyWithoutOrganizationNestedInput
  }

  export type OrganizationCreateManyInput = {
    id?: string
    name: string
    slug: string
    domain?: string | null
    logoUrl?: string | null
    status?: $Enums.OrgStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type OrganizationUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    domain?: NullableStringFieldUpdateOperationsInput | string | null
    logoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumOrgStatusFieldUpdateOperationsInput | $Enums.OrgStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    domain?: NullableStringFieldUpdateOperationsInput | string | null
    logoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumOrgStatusFieldUpdateOperationsInput | $Enums.OrgStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationMemberCreateInput = {
    id?: string
    role?: $Enums.OrgRole
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutMembersInput
    user: UserCreateNestedOneWithoutOrganizationsInput
  }

  export type OrganizationMemberUncheckedCreateInput = {
    id?: string
    organizationId: string
    userId: string
    role?: $Enums.OrgRole
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type OrganizationMemberUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    role?: EnumOrgRoleFieldUpdateOperationsInput | $Enums.OrgRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutMembersNestedInput
    user?: UserUpdateOneRequiredWithoutOrganizationsNestedInput
  }

  export type OrganizationMemberUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    role?: EnumOrgRoleFieldUpdateOperationsInput | $Enums.OrgRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationMemberCreateManyInput = {
    id?: string
    organizationId: string
    userId: string
    role?: $Enums.OrgRole
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type OrganizationMemberUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    role?: EnumOrgRoleFieldUpdateOperationsInput | $Enums.OrgRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationMemberUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    role?: EnumOrgRoleFieldUpdateOperationsInput | $Enums.OrgRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationInviteTokenCreateInput = {
    id?: string
    token?: string
    createdByUserId: string
    expiresAt: Date | string
    usedAt?: Date | string | null
    usedByUserId?: string | null
    createdAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutInviteTokensInput
  }

  export type OrganizationInviteTokenUncheckedCreateInput = {
    id?: string
    organizationId: string
    token?: string
    createdByUserId: string
    expiresAt: Date | string
    usedAt?: Date | string | null
    usedByUserId?: string | null
    createdAt?: Date | string
  }

  export type OrganizationInviteTokenUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    token?: StringFieldUpdateOperationsInput | string
    createdByUserId?: StringFieldUpdateOperationsInput | string
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    usedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    usedByUserId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutInviteTokensNestedInput
  }

  export type OrganizationInviteTokenUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    token?: StringFieldUpdateOperationsInput | string
    createdByUserId?: StringFieldUpdateOperationsInput | string
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    usedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    usedByUserId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationInviteTokenCreateManyInput = {
    id?: string
    organizationId: string
    token?: string
    createdByUserId: string
    expiresAt: Date | string
    usedAt?: Date | string | null
    usedByUserId?: string | null
    createdAt?: Date | string
  }

  export type OrganizationInviteTokenUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    token?: StringFieldUpdateOperationsInput | string
    createdByUserId?: StringFieldUpdateOperationsInput | string
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    usedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    usedByUserId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationInviteTokenUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    token?: StringFieldUpdateOperationsInput | string
    createdByUserId?: StringFieldUpdateOperationsInput | string
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    usedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    usedByUserId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TeamCreateInput = {
    id?: string
    name: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutTeamsInput
    members?: TeamMemberCreateNestedManyWithoutTeamInput
    projects?: ProjectCreateNestedManyWithoutTeamInput
  }

  export type TeamUncheckedCreateInput = {
    id?: string
    organizationId: string
    name: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    members?: TeamMemberUncheckedCreateNestedManyWithoutTeamInput
    projects?: ProjectUncheckedCreateNestedManyWithoutTeamInput
  }

  export type TeamUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutTeamsNestedInput
    members?: TeamMemberUpdateManyWithoutTeamNestedInput
    projects?: ProjectUpdateManyWithoutTeamNestedInput
  }

  export type TeamUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: TeamMemberUncheckedUpdateManyWithoutTeamNestedInput
    projects?: ProjectUncheckedUpdateManyWithoutTeamNestedInput
  }

  export type TeamCreateManyInput = {
    id?: string
    organizationId: string
    name: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TeamUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TeamUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TeamMemberCreateInput = {
    id?: string
    createdAt?: Date | string
    updatedAt?: Date | string
    team: TeamCreateNestedOneWithoutMembersInput
    user: UserCreateNestedOneWithoutTeamMembershipsInput
  }

  export type TeamMemberUncheckedCreateInput = {
    id?: string
    teamId: string
    userId: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TeamMemberUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    team?: TeamUpdateOneRequiredWithoutMembersNestedInput
    user?: UserUpdateOneRequiredWithoutTeamMembershipsNestedInput
  }

  export type TeamMemberUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    teamId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TeamMemberCreateManyInput = {
    id?: string
    teamId: string
    userId: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TeamMemberUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TeamMemberUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    teamId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectCreateInput = {
    id?: string
    name: string
    description?: string | null
    thumbnailUrl?: string | null
    stateUrl?: string | null
    isPublic?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    team: TeamCreateNestedOneWithoutProjectsInput
    members?: ProjectMemberCreateNestedManyWithoutProjectInput
    publishedAsset?: MarketplaceAssetCreateNestedOneWithoutProjectInput
    clonedFrom?: ProjectCloneCreateNestedOneWithoutClonedProjectInput
  }

  export type ProjectUncheckedCreateInput = {
    id?: string
    teamId: string
    name: string
    description?: string | null
    thumbnailUrl?: string | null
    stateUrl?: string | null
    isPublic?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    members?: ProjectMemberUncheckedCreateNestedManyWithoutProjectInput
    publishedAsset?: MarketplaceAssetUncheckedCreateNestedOneWithoutProjectInput
    clonedFrom?: ProjectCloneUncheckedCreateNestedOneWithoutClonedProjectInput
  }

  export type ProjectUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    stateUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    team?: TeamUpdateOneRequiredWithoutProjectsNestedInput
    members?: ProjectMemberUpdateManyWithoutProjectNestedInput
    publishedAsset?: MarketplaceAssetUpdateOneWithoutProjectNestedInput
    clonedFrom?: ProjectCloneUpdateOneWithoutClonedProjectNestedInput
  }

  export type ProjectUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    teamId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    stateUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: ProjectMemberUncheckedUpdateManyWithoutProjectNestedInput
    publishedAsset?: MarketplaceAssetUncheckedUpdateOneWithoutProjectNestedInput
    clonedFrom?: ProjectCloneUncheckedUpdateOneWithoutClonedProjectNestedInput
  }

  export type ProjectCreateManyInput = {
    id?: string
    teamId: string
    name: string
    description?: string | null
    thumbnailUrl?: string | null
    stateUrl?: string | null
    isPublic?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ProjectUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    stateUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    teamId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    stateUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectMemberCreateInput = {
    id?: string
    role?: $Enums.ProjectRole
    createdAt?: Date | string
    project: ProjectCreateNestedOneWithoutMembersInput
    user: UserCreateNestedOneWithoutProjectMembershipsInput
  }

  export type ProjectMemberUncheckedCreateInput = {
    id?: string
    projectId: string
    userId: string
    role?: $Enums.ProjectRole
    createdAt?: Date | string
  }

  export type ProjectMemberUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    role?: EnumProjectRoleFieldUpdateOperationsInput | $Enums.ProjectRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    project?: ProjectUpdateOneRequiredWithoutMembersNestedInput
    user?: UserUpdateOneRequiredWithoutProjectMembershipsNestedInput
  }

  export type ProjectMemberUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    role?: EnumProjectRoleFieldUpdateOperationsInput | $Enums.ProjectRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectMemberCreateManyInput = {
    id?: string
    projectId: string
    userId: string
    role?: $Enums.ProjectRole
    createdAt?: Date | string
  }

  export type ProjectMemberUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    role?: EnumProjectRoleFieldUpdateOperationsInput | $Enums.ProjectRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectMemberUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    role?: EnumProjectRoleFieldUpdateOperationsInput | $Enums.ProjectRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MarketplaceAssetCreateInput = {
    id?: string
    title: string
    description?: string | null
    tags?: MarketplaceAssetCreatetagsInput | string[]
    thumbnailUrl?: string | null
    isPublished?: boolean
    cloneCount?: number
    createdAt?: Date | string
    updatedAt?: Date | string
    project: ProjectCreateNestedOneWithoutPublishedAssetInput
    author: UserCreateNestedOneWithoutPublishedAssetsInput
    clones?: ProjectCloneCreateNestedManyWithoutAssetInput
  }

  export type MarketplaceAssetUncheckedCreateInput = {
    id?: string
    projectId: string
    authorId: string
    title: string
    description?: string | null
    tags?: MarketplaceAssetCreatetagsInput | string[]
    thumbnailUrl?: string | null
    isPublished?: boolean
    cloneCount?: number
    createdAt?: Date | string
    updatedAt?: Date | string
    clones?: ProjectCloneUncheckedCreateNestedManyWithoutAssetInput
  }

  export type MarketplaceAssetUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: MarketplaceAssetUpdatetagsInput | string[]
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublished?: BoolFieldUpdateOperationsInput | boolean
    cloneCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    project?: ProjectUpdateOneRequiredWithoutPublishedAssetNestedInput
    author?: UserUpdateOneRequiredWithoutPublishedAssetsNestedInput
    clones?: ProjectCloneUpdateManyWithoutAssetNestedInput
  }

  export type MarketplaceAssetUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    authorId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: MarketplaceAssetUpdatetagsInput | string[]
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublished?: BoolFieldUpdateOperationsInput | boolean
    cloneCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    clones?: ProjectCloneUncheckedUpdateManyWithoutAssetNestedInput
  }

  export type MarketplaceAssetCreateManyInput = {
    id?: string
    projectId: string
    authorId: string
    title: string
    description?: string | null
    tags?: MarketplaceAssetCreatetagsInput | string[]
    thumbnailUrl?: string | null
    isPublished?: boolean
    cloneCount?: number
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type MarketplaceAssetUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: MarketplaceAssetUpdatetagsInput | string[]
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublished?: BoolFieldUpdateOperationsInput | boolean
    cloneCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MarketplaceAssetUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    authorId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: MarketplaceAssetUpdatetagsInput | string[]
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublished?: BoolFieldUpdateOperationsInput | boolean
    cloneCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectCloneCreateInput = {
    id?: string
    createdAt?: Date | string
    asset: MarketplaceAssetCreateNestedOneWithoutClonesInput
    clonedProject: ProjectCreateNestedOneWithoutClonedFromInput
    clonedBy: UserCreateNestedOneWithoutClonedProjectsInput
  }

  export type ProjectCloneUncheckedCreateInput = {
    id?: string
    sourceAssetId: string
    clonedProjectId: string
    clonedByUserId: string
    createdAt?: Date | string
  }

  export type ProjectCloneUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    asset?: MarketplaceAssetUpdateOneRequiredWithoutClonesNestedInput
    clonedProject?: ProjectUpdateOneRequiredWithoutClonedFromNestedInput
    clonedBy?: UserUpdateOneRequiredWithoutClonedProjectsNestedInput
  }

  export type ProjectCloneUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    sourceAssetId?: StringFieldUpdateOperationsInput | string
    clonedProjectId?: StringFieldUpdateOperationsInput | string
    clonedByUserId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectCloneCreateManyInput = {
    id?: string
    sourceAssetId: string
    clonedProjectId: string
    clonedByUserId: string
    createdAt?: Date | string
  }

  export type ProjectCloneUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectCloneUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    sourceAssetId?: StringFieldUpdateOperationsInput | string
    clonedProjectId?: StringFieldUpdateOperationsInput | string
    clonedByUserId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type EarlyAccessApplicationCreateInput = {
    id?: string
    orgName: string
    contactName: string
    contactEmail: string
    domain?: string | null
    useCase: string
    teamSize: number
    status?: $Enums.OrgStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type EarlyAccessApplicationUncheckedCreateInput = {
    id?: string
    orgName: string
    contactName: string
    contactEmail: string
    domain?: string | null
    useCase: string
    teamSize: number
    status?: $Enums.OrgStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type EarlyAccessApplicationUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    orgName?: StringFieldUpdateOperationsInput | string
    contactName?: StringFieldUpdateOperationsInput | string
    contactEmail?: StringFieldUpdateOperationsInput | string
    domain?: NullableStringFieldUpdateOperationsInput | string | null
    useCase?: StringFieldUpdateOperationsInput | string
    teamSize?: IntFieldUpdateOperationsInput | number
    status?: EnumOrgStatusFieldUpdateOperationsInput | $Enums.OrgStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type EarlyAccessApplicationUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    orgName?: StringFieldUpdateOperationsInput | string
    contactName?: StringFieldUpdateOperationsInput | string
    contactEmail?: StringFieldUpdateOperationsInput | string
    domain?: NullableStringFieldUpdateOperationsInput | string | null
    useCase?: StringFieldUpdateOperationsInput | string
    teamSize?: IntFieldUpdateOperationsInput | number
    status?: EnumOrgStatusFieldUpdateOperationsInput | $Enums.OrgStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type EarlyAccessApplicationCreateManyInput = {
    id?: string
    orgName: string
    contactName: string
    contactEmail: string
    domain?: string | null
    useCase: string
    teamSize: number
    status?: $Enums.OrgStatus
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type EarlyAccessApplicationUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    orgName?: StringFieldUpdateOperationsInput | string
    contactName?: StringFieldUpdateOperationsInput | string
    contactEmail?: StringFieldUpdateOperationsInput | string
    domain?: NullableStringFieldUpdateOperationsInput | string | null
    useCase?: StringFieldUpdateOperationsInput | string
    teamSize?: IntFieldUpdateOperationsInput | number
    status?: EnumOrgStatusFieldUpdateOperationsInput | $Enums.OrgStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type EarlyAccessApplicationUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    orgName?: StringFieldUpdateOperationsInput | string
    contactName?: StringFieldUpdateOperationsInput | string
    contactEmail?: StringFieldUpdateOperationsInput | string
    domain?: NullableStringFieldUpdateOperationsInput | string | null
    useCase?: StringFieldUpdateOperationsInput | string
    teamSize?: IntFieldUpdateOperationsInput | number
    status?: EnumOrgStatusFieldUpdateOperationsInput | $Enums.OrgStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PasswordResetTokenCreateInput = {
    id?: string
    token: string
    email: string
    expiresAt: Date | string
    usedAt?: Date | string | null
    createdAt?: Date | string
  }

  export type PasswordResetTokenUncheckedCreateInput = {
    id?: string
    token: string
    email: string
    expiresAt: Date | string
    usedAt?: Date | string | null
    createdAt?: Date | string
  }

  export type PasswordResetTokenUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    token?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    usedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PasswordResetTokenUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    token?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    usedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PasswordResetTokenCreateManyInput = {
    id?: string
    token: string
    email: string
    expiresAt: Date | string
    usedAt?: Date | string | null
    createdAt?: Date | string
  }

  export type PasswordResetTokenUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    token?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    usedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type PasswordResetTokenUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    token?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    usedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type DateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type BoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type OnboardingProgressNullableRelationFilter = {
    is?: OnboardingProgressWhereInput | null
    isNot?: OnboardingProgressWhereInput | null
  }

  export type OrganizationMemberListRelationFilter = {
    every?: OrganizationMemberWhereInput
    some?: OrganizationMemberWhereInput
    none?: OrganizationMemberWhereInput
  }

  export type TeamMemberListRelationFilter = {
    every?: TeamMemberWhereInput
    some?: TeamMemberWhereInput
    none?: TeamMemberWhereInput
  }

  export type ProjectMemberListRelationFilter = {
    every?: ProjectMemberWhereInput
    some?: ProjectMemberWhereInput
    none?: ProjectMemberWhereInput
  }

  export type MarketplaceAssetListRelationFilter = {
    every?: MarketplaceAssetWhereInput
    some?: MarketplaceAssetWhereInput
    none?: MarketplaceAssetWhereInput
  }

  export type ProjectCloneListRelationFilter = {
    every?: ProjectCloneWhereInput
    some?: ProjectCloneWhereInput
    none?: ProjectCloneWhereInput
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type OrganizationMemberOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type TeamMemberOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type ProjectMemberOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type MarketplaceAssetOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type ProjectCloneOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type UserCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    email?: SortOrder
    emailVerified?: SortOrder
    image?: SortOrder
    password?: SortOrder
    bio?: SortOrder
    onboardingComplete?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    email?: SortOrder
    emailVerified?: SortOrder
    image?: SortOrder
    password?: SortOrder
    bio?: SortOrder
    onboardingComplete?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    email?: SortOrder
    emailVerified?: SortOrder
    image?: SortOrder
    password?: SortOrder
    bio?: SortOrder
    onboardingComplete?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type DateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type BoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type IntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }
  export type JsonFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<JsonFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonFilterBase<$PrismaModel>>, 'path'>>

  export type JsonFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type UserRelationFilter = {
    is?: UserWhereInput
    isNot?: UserWhereInput
  }

  export type OnboardingProgressCountOrderByAggregateInput = {
    userId?: SortOrder
    currentStep?: SortOrder
    selections?: SortOrder
    completedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type OnboardingProgressAvgOrderByAggregateInput = {
    currentStep?: SortOrder
  }

  export type OnboardingProgressMaxOrderByAggregateInput = {
    userId?: SortOrder
    currentStep?: SortOrder
    completedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type OnboardingProgressMinOrderByAggregateInput = {
    userId?: SortOrder
    currentStep?: SortOrder
    completedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type OnboardingProgressSumOrderByAggregateInput = {
    currentStep?: SortOrder
  }

  export type IntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }
  export type JsonWithAggregatesFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<JsonWithAggregatesFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonWithAggregatesFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonWithAggregatesFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonWithAggregatesFilterBase<$PrismaModel>>, 'path'>>

  export type JsonWithAggregatesFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedJsonFilter<$PrismaModel>
    _max?: NestedJsonFilter<$PrismaModel>
  }

  export type EnumOrgStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.OrgStatus | EnumOrgStatusFieldRefInput<$PrismaModel>
    in?: $Enums.OrgStatus[] | ListEnumOrgStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.OrgStatus[] | ListEnumOrgStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumOrgStatusFilter<$PrismaModel> | $Enums.OrgStatus
  }

  export type TeamListRelationFilter = {
    every?: TeamWhereInput
    some?: TeamWhereInput
    none?: TeamWhereInput
  }

  export type OrganizationInviteTokenListRelationFilter = {
    every?: OrganizationInviteTokenWhereInput
    some?: OrganizationInviteTokenWhereInput
    none?: OrganizationInviteTokenWhereInput
  }

  export type TeamOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type OrganizationInviteTokenOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type OrganizationCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    slug?: SortOrder
    domain?: SortOrder
    logoUrl?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type OrganizationMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    slug?: SortOrder
    domain?: SortOrder
    logoUrl?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type OrganizationMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    slug?: SortOrder
    domain?: SortOrder
    logoUrl?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type EnumOrgStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.OrgStatus | EnumOrgStatusFieldRefInput<$PrismaModel>
    in?: $Enums.OrgStatus[] | ListEnumOrgStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.OrgStatus[] | ListEnumOrgStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumOrgStatusWithAggregatesFilter<$PrismaModel> | $Enums.OrgStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumOrgStatusFilter<$PrismaModel>
    _max?: NestedEnumOrgStatusFilter<$PrismaModel>
  }

  export type EnumOrgRoleFilter<$PrismaModel = never> = {
    equals?: $Enums.OrgRole | EnumOrgRoleFieldRefInput<$PrismaModel>
    in?: $Enums.OrgRole[] | ListEnumOrgRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.OrgRole[] | ListEnumOrgRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumOrgRoleFilter<$PrismaModel> | $Enums.OrgRole
  }

  export type OrganizationRelationFilter = {
    is?: OrganizationWhereInput
    isNot?: OrganizationWhereInput
  }

  export type OrganizationMemberOrganizationIdUserIdCompoundUniqueInput = {
    organizationId: string
    userId: string
  }

  export type OrganizationMemberCountOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    userId?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type OrganizationMemberMaxOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    userId?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type OrganizationMemberMinOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    userId?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type EnumOrgRoleWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.OrgRole | EnumOrgRoleFieldRefInput<$PrismaModel>
    in?: $Enums.OrgRole[] | ListEnumOrgRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.OrgRole[] | ListEnumOrgRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumOrgRoleWithAggregatesFilter<$PrismaModel> | $Enums.OrgRole
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumOrgRoleFilter<$PrismaModel>
    _max?: NestedEnumOrgRoleFilter<$PrismaModel>
  }

  export type OrganizationInviteTokenCountOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    token?: SortOrder
    createdByUserId?: SortOrder
    expiresAt?: SortOrder
    usedAt?: SortOrder
    usedByUserId?: SortOrder
    createdAt?: SortOrder
  }

  export type OrganizationInviteTokenMaxOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    token?: SortOrder
    createdByUserId?: SortOrder
    expiresAt?: SortOrder
    usedAt?: SortOrder
    usedByUserId?: SortOrder
    createdAt?: SortOrder
  }

  export type OrganizationInviteTokenMinOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    token?: SortOrder
    createdByUserId?: SortOrder
    expiresAt?: SortOrder
    usedAt?: SortOrder
    usedByUserId?: SortOrder
    createdAt?: SortOrder
  }

  export type ProjectListRelationFilter = {
    every?: ProjectWhereInput
    some?: ProjectWhereInput
    none?: ProjectWhereInput
  }

  export type ProjectOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type TeamCountOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TeamMaxOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TeamMinOrderByAggregateInput = {
    id?: SortOrder
    organizationId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TeamRelationFilter = {
    is?: TeamWhereInput
    isNot?: TeamWhereInput
  }

  export type TeamMemberTeamIdUserIdCompoundUniqueInput = {
    teamId: string
    userId: string
  }

  export type TeamMemberCountOrderByAggregateInput = {
    id?: SortOrder
    teamId?: SortOrder
    userId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TeamMemberMaxOrderByAggregateInput = {
    id?: SortOrder
    teamId?: SortOrder
    userId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TeamMemberMinOrderByAggregateInput = {
    id?: SortOrder
    teamId?: SortOrder
    userId?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MarketplaceAssetNullableRelationFilter = {
    is?: MarketplaceAssetWhereInput | null
    isNot?: MarketplaceAssetWhereInput | null
  }

  export type ProjectCloneNullableRelationFilter = {
    is?: ProjectCloneWhereInput | null
    isNot?: ProjectCloneWhereInput | null
  }

  export type ProjectCountOrderByAggregateInput = {
    id?: SortOrder
    teamId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    thumbnailUrl?: SortOrder
    stateUrl?: SortOrder
    isPublic?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ProjectMaxOrderByAggregateInput = {
    id?: SortOrder
    teamId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    thumbnailUrl?: SortOrder
    stateUrl?: SortOrder
    isPublic?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type ProjectMinOrderByAggregateInput = {
    id?: SortOrder
    teamId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    thumbnailUrl?: SortOrder
    stateUrl?: SortOrder
    isPublic?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type EnumProjectRoleFilter<$PrismaModel = never> = {
    equals?: $Enums.ProjectRole | EnumProjectRoleFieldRefInput<$PrismaModel>
    in?: $Enums.ProjectRole[] | ListEnumProjectRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.ProjectRole[] | ListEnumProjectRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumProjectRoleFilter<$PrismaModel> | $Enums.ProjectRole
  }

  export type ProjectRelationFilter = {
    is?: ProjectWhereInput
    isNot?: ProjectWhereInput
  }

  export type ProjectMemberProjectIdUserIdCompoundUniqueInput = {
    projectId: string
    userId: string
  }

  export type ProjectMemberCountOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    userId?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
  }

  export type ProjectMemberMaxOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    userId?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
  }

  export type ProjectMemberMinOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    userId?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
  }

  export type EnumProjectRoleWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.ProjectRole | EnumProjectRoleFieldRefInput<$PrismaModel>
    in?: $Enums.ProjectRole[] | ListEnumProjectRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.ProjectRole[] | ListEnumProjectRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumProjectRoleWithAggregatesFilter<$PrismaModel> | $Enums.ProjectRole
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumProjectRoleFilter<$PrismaModel>
    _max?: NestedEnumProjectRoleFilter<$PrismaModel>
  }

  export type StringNullableListFilter<$PrismaModel = never> = {
    equals?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    has?: string | StringFieldRefInput<$PrismaModel> | null
    hasEvery?: string[] | ListStringFieldRefInput<$PrismaModel>
    hasSome?: string[] | ListStringFieldRefInput<$PrismaModel>
    isEmpty?: boolean
  }

  export type MarketplaceAssetCountOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    authorId?: SortOrder
    title?: SortOrder
    description?: SortOrder
    tags?: SortOrder
    thumbnailUrl?: SortOrder
    isPublished?: SortOrder
    cloneCount?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MarketplaceAssetAvgOrderByAggregateInput = {
    cloneCount?: SortOrder
  }

  export type MarketplaceAssetMaxOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    authorId?: SortOrder
    title?: SortOrder
    description?: SortOrder
    thumbnailUrl?: SortOrder
    isPublished?: SortOrder
    cloneCount?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MarketplaceAssetMinOrderByAggregateInput = {
    id?: SortOrder
    projectId?: SortOrder
    authorId?: SortOrder
    title?: SortOrder
    description?: SortOrder
    thumbnailUrl?: SortOrder
    isPublished?: SortOrder
    cloneCount?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type MarketplaceAssetSumOrderByAggregateInput = {
    cloneCount?: SortOrder
  }

  export type MarketplaceAssetRelationFilter = {
    is?: MarketplaceAssetWhereInput
    isNot?: MarketplaceAssetWhereInput
  }

  export type ProjectCloneCountOrderByAggregateInput = {
    id?: SortOrder
    sourceAssetId?: SortOrder
    clonedProjectId?: SortOrder
    clonedByUserId?: SortOrder
    createdAt?: SortOrder
  }

  export type ProjectCloneMaxOrderByAggregateInput = {
    id?: SortOrder
    sourceAssetId?: SortOrder
    clonedProjectId?: SortOrder
    clonedByUserId?: SortOrder
    createdAt?: SortOrder
  }

  export type ProjectCloneMinOrderByAggregateInput = {
    id?: SortOrder
    sourceAssetId?: SortOrder
    clonedProjectId?: SortOrder
    clonedByUserId?: SortOrder
    createdAt?: SortOrder
  }

  export type EarlyAccessApplicationCountOrderByAggregateInput = {
    id?: SortOrder
    orgName?: SortOrder
    contactName?: SortOrder
    contactEmail?: SortOrder
    domain?: SortOrder
    useCase?: SortOrder
    teamSize?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type EarlyAccessApplicationAvgOrderByAggregateInput = {
    teamSize?: SortOrder
  }

  export type EarlyAccessApplicationMaxOrderByAggregateInput = {
    id?: SortOrder
    orgName?: SortOrder
    contactName?: SortOrder
    contactEmail?: SortOrder
    domain?: SortOrder
    useCase?: SortOrder
    teamSize?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type EarlyAccessApplicationMinOrderByAggregateInput = {
    id?: SortOrder
    orgName?: SortOrder
    contactName?: SortOrder
    contactEmail?: SortOrder
    domain?: SortOrder
    useCase?: SortOrder
    teamSize?: SortOrder
    status?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type EarlyAccessApplicationSumOrderByAggregateInput = {
    teamSize?: SortOrder
  }

  export type PasswordResetTokenCountOrderByAggregateInput = {
    id?: SortOrder
    token?: SortOrder
    email?: SortOrder
    expiresAt?: SortOrder
    usedAt?: SortOrder
    createdAt?: SortOrder
  }

  export type PasswordResetTokenMaxOrderByAggregateInput = {
    id?: SortOrder
    token?: SortOrder
    email?: SortOrder
    expiresAt?: SortOrder
    usedAt?: SortOrder
    createdAt?: SortOrder
  }

  export type PasswordResetTokenMinOrderByAggregateInput = {
    id?: SortOrder
    token?: SortOrder
    email?: SortOrder
    expiresAt?: SortOrder
    usedAt?: SortOrder
    createdAt?: SortOrder
  }

  export type OnboardingProgressCreateNestedOneWithoutUserInput = {
    create?: XOR<OnboardingProgressCreateWithoutUserInput, OnboardingProgressUncheckedCreateWithoutUserInput>
    connectOrCreate?: OnboardingProgressCreateOrConnectWithoutUserInput
    connect?: OnboardingProgressWhereUniqueInput
  }

  export type OrganizationMemberCreateNestedManyWithoutUserInput = {
    create?: XOR<OrganizationMemberCreateWithoutUserInput, OrganizationMemberUncheckedCreateWithoutUserInput> | OrganizationMemberCreateWithoutUserInput[] | OrganizationMemberUncheckedCreateWithoutUserInput[]
    connectOrCreate?: OrganizationMemberCreateOrConnectWithoutUserInput | OrganizationMemberCreateOrConnectWithoutUserInput[]
    createMany?: OrganizationMemberCreateManyUserInputEnvelope
    connect?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
  }

  export type TeamMemberCreateNestedManyWithoutUserInput = {
    create?: XOR<TeamMemberCreateWithoutUserInput, TeamMemberUncheckedCreateWithoutUserInput> | TeamMemberCreateWithoutUserInput[] | TeamMemberUncheckedCreateWithoutUserInput[]
    connectOrCreate?: TeamMemberCreateOrConnectWithoutUserInput | TeamMemberCreateOrConnectWithoutUserInput[]
    createMany?: TeamMemberCreateManyUserInputEnvelope
    connect?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
  }

  export type ProjectMemberCreateNestedManyWithoutUserInput = {
    create?: XOR<ProjectMemberCreateWithoutUserInput, ProjectMemberUncheckedCreateWithoutUserInput> | ProjectMemberCreateWithoutUserInput[] | ProjectMemberUncheckedCreateWithoutUserInput[]
    connectOrCreate?: ProjectMemberCreateOrConnectWithoutUserInput | ProjectMemberCreateOrConnectWithoutUserInput[]
    createMany?: ProjectMemberCreateManyUserInputEnvelope
    connect?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
  }

  export type MarketplaceAssetCreateNestedManyWithoutAuthorInput = {
    create?: XOR<MarketplaceAssetCreateWithoutAuthorInput, MarketplaceAssetUncheckedCreateWithoutAuthorInput> | MarketplaceAssetCreateWithoutAuthorInput[] | MarketplaceAssetUncheckedCreateWithoutAuthorInput[]
    connectOrCreate?: MarketplaceAssetCreateOrConnectWithoutAuthorInput | MarketplaceAssetCreateOrConnectWithoutAuthorInput[]
    createMany?: MarketplaceAssetCreateManyAuthorInputEnvelope
    connect?: MarketplaceAssetWhereUniqueInput | MarketplaceAssetWhereUniqueInput[]
  }

  export type ProjectCloneCreateNestedManyWithoutClonedByInput = {
    create?: XOR<ProjectCloneCreateWithoutClonedByInput, ProjectCloneUncheckedCreateWithoutClonedByInput> | ProjectCloneCreateWithoutClonedByInput[] | ProjectCloneUncheckedCreateWithoutClonedByInput[]
    connectOrCreate?: ProjectCloneCreateOrConnectWithoutClonedByInput | ProjectCloneCreateOrConnectWithoutClonedByInput[]
    createMany?: ProjectCloneCreateManyClonedByInputEnvelope
    connect?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
  }

  export type OnboardingProgressUncheckedCreateNestedOneWithoutUserInput = {
    create?: XOR<OnboardingProgressCreateWithoutUserInput, OnboardingProgressUncheckedCreateWithoutUserInput>
    connectOrCreate?: OnboardingProgressCreateOrConnectWithoutUserInput
    connect?: OnboardingProgressWhereUniqueInput
  }

  export type OrganizationMemberUncheckedCreateNestedManyWithoutUserInput = {
    create?: XOR<OrganizationMemberCreateWithoutUserInput, OrganizationMemberUncheckedCreateWithoutUserInput> | OrganizationMemberCreateWithoutUserInput[] | OrganizationMemberUncheckedCreateWithoutUserInput[]
    connectOrCreate?: OrganizationMemberCreateOrConnectWithoutUserInput | OrganizationMemberCreateOrConnectWithoutUserInput[]
    createMany?: OrganizationMemberCreateManyUserInputEnvelope
    connect?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
  }

  export type TeamMemberUncheckedCreateNestedManyWithoutUserInput = {
    create?: XOR<TeamMemberCreateWithoutUserInput, TeamMemberUncheckedCreateWithoutUserInput> | TeamMemberCreateWithoutUserInput[] | TeamMemberUncheckedCreateWithoutUserInput[]
    connectOrCreate?: TeamMemberCreateOrConnectWithoutUserInput | TeamMemberCreateOrConnectWithoutUserInput[]
    createMany?: TeamMemberCreateManyUserInputEnvelope
    connect?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
  }

  export type ProjectMemberUncheckedCreateNestedManyWithoutUserInput = {
    create?: XOR<ProjectMemberCreateWithoutUserInput, ProjectMemberUncheckedCreateWithoutUserInput> | ProjectMemberCreateWithoutUserInput[] | ProjectMemberUncheckedCreateWithoutUserInput[]
    connectOrCreate?: ProjectMemberCreateOrConnectWithoutUserInput | ProjectMemberCreateOrConnectWithoutUserInput[]
    createMany?: ProjectMemberCreateManyUserInputEnvelope
    connect?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
  }

  export type MarketplaceAssetUncheckedCreateNestedManyWithoutAuthorInput = {
    create?: XOR<MarketplaceAssetCreateWithoutAuthorInput, MarketplaceAssetUncheckedCreateWithoutAuthorInput> | MarketplaceAssetCreateWithoutAuthorInput[] | MarketplaceAssetUncheckedCreateWithoutAuthorInput[]
    connectOrCreate?: MarketplaceAssetCreateOrConnectWithoutAuthorInput | MarketplaceAssetCreateOrConnectWithoutAuthorInput[]
    createMany?: MarketplaceAssetCreateManyAuthorInputEnvelope
    connect?: MarketplaceAssetWhereUniqueInput | MarketplaceAssetWhereUniqueInput[]
  }

  export type ProjectCloneUncheckedCreateNestedManyWithoutClonedByInput = {
    create?: XOR<ProjectCloneCreateWithoutClonedByInput, ProjectCloneUncheckedCreateWithoutClonedByInput> | ProjectCloneCreateWithoutClonedByInput[] | ProjectCloneUncheckedCreateWithoutClonedByInput[]
    connectOrCreate?: ProjectCloneCreateOrConnectWithoutClonedByInput | ProjectCloneCreateOrConnectWithoutClonedByInput[]
    createMany?: ProjectCloneCreateManyClonedByInputEnvelope
    connect?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type OnboardingProgressUpdateOneWithoutUserNestedInput = {
    create?: XOR<OnboardingProgressCreateWithoutUserInput, OnboardingProgressUncheckedCreateWithoutUserInput>
    connectOrCreate?: OnboardingProgressCreateOrConnectWithoutUserInput
    upsert?: OnboardingProgressUpsertWithoutUserInput
    disconnect?: OnboardingProgressWhereInput | boolean
    delete?: OnboardingProgressWhereInput | boolean
    connect?: OnboardingProgressWhereUniqueInput
    update?: XOR<XOR<OnboardingProgressUpdateToOneWithWhereWithoutUserInput, OnboardingProgressUpdateWithoutUserInput>, OnboardingProgressUncheckedUpdateWithoutUserInput>
  }

  export type OrganizationMemberUpdateManyWithoutUserNestedInput = {
    create?: XOR<OrganizationMemberCreateWithoutUserInput, OrganizationMemberUncheckedCreateWithoutUserInput> | OrganizationMemberCreateWithoutUserInput[] | OrganizationMemberUncheckedCreateWithoutUserInput[]
    connectOrCreate?: OrganizationMemberCreateOrConnectWithoutUserInput | OrganizationMemberCreateOrConnectWithoutUserInput[]
    upsert?: OrganizationMemberUpsertWithWhereUniqueWithoutUserInput | OrganizationMemberUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: OrganizationMemberCreateManyUserInputEnvelope
    set?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    disconnect?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    delete?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    connect?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    update?: OrganizationMemberUpdateWithWhereUniqueWithoutUserInput | OrganizationMemberUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: OrganizationMemberUpdateManyWithWhereWithoutUserInput | OrganizationMemberUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: OrganizationMemberScalarWhereInput | OrganizationMemberScalarWhereInput[]
  }

  export type TeamMemberUpdateManyWithoutUserNestedInput = {
    create?: XOR<TeamMemberCreateWithoutUserInput, TeamMemberUncheckedCreateWithoutUserInput> | TeamMemberCreateWithoutUserInput[] | TeamMemberUncheckedCreateWithoutUserInput[]
    connectOrCreate?: TeamMemberCreateOrConnectWithoutUserInput | TeamMemberCreateOrConnectWithoutUserInput[]
    upsert?: TeamMemberUpsertWithWhereUniqueWithoutUserInput | TeamMemberUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: TeamMemberCreateManyUserInputEnvelope
    set?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    disconnect?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    delete?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    connect?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    update?: TeamMemberUpdateWithWhereUniqueWithoutUserInput | TeamMemberUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: TeamMemberUpdateManyWithWhereWithoutUserInput | TeamMemberUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: TeamMemberScalarWhereInput | TeamMemberScalarWhereInput[]
  }

  export type ProjectMemberUpdateManyWithoutUserNestedInput = {
    create?: XOR<ProjectMemberCreateWithoutUserInput, ProjectMemberUncheckedCreateWithoutUserInput> | ProjectMemberCreateWithoutUserInput[] | ProjectMemberUncheckedCreateWithoutUserInput[]
    connectOrCreate?: ProjectMemberCreateOrConnectWithoutUserInput | ProjectMemberCreateOrConnectWithoutUserInput[]
    upsert?: ProjectMemberUpsertWithWhereUniqueWithoutUserInput | ProjectMemberUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: ProjectMemberCreateManyUserInputEnvelope
    set?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    disconnect?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    delete?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    connect?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    update?: ProjectMemberUpdateWithWhereUniqueWithoutUserInput | ProjectMemberUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: ProjectMemberUpdateManyWithWhereWithoutUserInput | ProjectMemberUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: ProjectMemberScalarWhereInput | ProjectMemberScalarWhereInput[]
  }

  export type MarketplaceAssetUpdateManyWithoutAuthorNestedInput = {
    create?: XOR<MarketplaceAssetCreateWithoutAuthorInput, MarketplaceAssetUncheckedCreateWithoutAuthorInput> | MarketplaceAssetCreateWithoutAuthorInput[] | MarketplaceAssetUncheckedCreateWithoutAuthorInput[]
    connectOrCreate?: MarketplaceAssetCreateOrConnectWithoutAuthorInput | MarketplaceAssetCreateOrConnectWithoutAuthorInput[]
    upsert?: MarketplaceAssetUpsertWithWhereUniqueWithoutAuthorInput | MarketplaceAssetUpsertWithWhereUniqueWithoutAuthorInput[]
    createMany?: MarketplaceAssetCreateManyAuthorInputEnvelope
    set?: MarketplaceAssetWhereUniqueInput | MarketplaceAssetWhereUniqueInput[]
    disconnect?: MarketplaceAssetWhereUniqueInput | MarketplaceAssetWhereUniqueInput[]
    delete?: MarketplaceAssetWhereUniqueInput | MarketplaceAssetWhereUniqueInput[]
    connect?: MarketplaceAssetWhereUniqueInput | MarketplaceAssetWhereUniqueInput[]
    update?: MarketplaceAssetUpdateWithWhereUniqueWithoutAuthorInput | MarketplaceAssetUpdateWithWhereUniqueWithoutAuthorInput[]
    updateMany?: MarketplaceAssetUpdateManyWithWhereWithoutAuthorInput | MarketplaceAssetUpdateManyWithWhereWithoutAuthorInput[]
    deleteMany?: MarketplaceAssetScalarWhereInput | MarketplaceAssetScalarWhereInput[]
  }

  export type ProjectCloneUpdateManyWithoutClonedByNestedInput = {
    create?: XOR<ProjectCloneCreateWithoutClonedByInput, ProjectCloneUncheckedCreateWithoutClonedByInput> | ProjectCloneCreateWithoutClonedByInput[] | ProjectCloneUncheckedCreateWithoutClonedByInput[]
    connectOrCreate?: ProjectCloneCreateOrConnectWithoutClonedByInput | ProjectCloneCreateOrConnectWithoutClonedByInput[]
    upsert?: ProjectCloneUpsertWithWhereUniqueWithoutClonedByInput | ProjectCloneUpsertWithWhereUniqueWithoutClonedByInput[]
    createMany?: ProjectCloneCreateManyClonedByInputEnvelope
    set?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    disconnect?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    delete?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    connect?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    update?: ProjectCloneUpdateWithWhereUniqueWithoutClonedByInput | ProjectCloneUpdateWithWhereUniqueWithoutClonedByInput[]
    updateMany?: ProjectCloneUpdateManyWithWhereWithoutClonedByInput | ProjectCloneUpdateManyWithWhereWithoutClonedByInput[]
    deleteMany?: ProjectCloneScalarWhereInput | ProjectCloneScalarWhereInput[]
  }

  export type OnboardingProgressUncheckedUpdateOneWithoutUserNestedInput = {
    create?: XOR<OnboardingProgressCreateWithoutUserInput, OnboardingProgressUncheckedCreateWithoutUserInput>
    connectOrCreate?: OnboardingProgressCreateOrConnectWithoutUserInput
    upsert?: OnboardingProgressUpsertWithoutUserInput
    disconnect?: OnboardingProgressWhereInput | boolean
    delete?: OnboardingProgressWhereInput | boolean
    connect?: OnboardingProgressWhereUniqueInput
    update?: XOR<XOR<OnboardingProgressUpdateToOneWithWhereWithoutUserInput, OnboardingProgressUpdateWithoutUserInput>, OnboardingProgressUncheckedUpdateWithoutUserInput>
  }

  export type OrganizationMemberUncheckedUpdateManyWithoutUserNestedInput = {
    create?: XOR<OrganizationMemberCreateWithoutUserInput, OrganizationMemberUncheckedCreateWithoutUserInput> | OrganizationMemberCreateWithoutUserInput[] | OrganizationMemberUncheckedCreateWithoutUserInput[]
    connectOrCreate?: OrganizationMemberCreateOrConnectWithoutUserInput | OrganizationMemberCreateOrConnectWithoutUserInput[]
    upsert?: OrganizationMemberUpsertWithWhereUniqueWithoutUserInput | OrganizationMemberUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: OrganizationMemberCreateManyUserInputEnvelope
    set?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    disconnect?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    delete?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    connect?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    update?: OrganizationMemberUpdateWithWhereUniqueWithoutUserInput | OrganizationMemberUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: OrganizationMemberUpdateManyWithWhereWithoutUserInput | OrganizationMemberUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: OrganizationMemberScalarWhereInput | OrganizationMemberScalarWhereInput[]
  }

  export type TeamMemberUncheckedUpdateManyWithoutUserNestedInput = {
    create?: XOR<TeamMemberCreateWithoutUserInput, TeamMemberUncheckedCreateWithoutUserInput> | TeamMemberCreateWithoutUserInput[] | TeamMemberUncheckedCreateWithoutUserInput[]
    connectOrCreate?: TeamMemberCreateOrConnectWithoutUserInput | TeamMemberCreateOrConnectWithoutUserInput[]
    upsert?: TeamMemberUpsertWithWhereUniqueWithoutUserInput | TeamMemberUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: TeamMemberCreateManyUserInputEnvelope
    set?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    disconnect?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    delete?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    connect?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    update?: TeamMemberUpdateWithWhereUniqueWithoutUserInput | TeamMemberUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: TeamMemberUpdateManyWithWhereWithoutUserInput | TeamMemberUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: TeamMemberScalarWhereInput | TeamMemberScalarWhereInput[]
  }

  export type ProjectMemberUncheckedUpdateManyWithoutUserNestedInput = {
    create?: XOR<ProjectMemberCreateWithoutUserInput, ProjectMemberUncheckedCreateWithoutUserInput> | ProjectMemberCreateWithoutUserInput[] | ProjectMemberUncheckedCreateWithoutUserInput[]
    connectOrCreate?: ProjectMemberCreateOrConnectWithoutUserInput | ProjectMemberCreateOrConnectWithoutUserInput[]
    upsert?: ProjectMemberUpsertWithWhereUniqueWithoutUserInput | ProjectMemberUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: ProjectMemberCreateManyUserInputEnvelope
    set?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    disconnect?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    delete?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    connect?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    update?: ProjectMemberUpdateWithWhereUniqueWithoutUserInput | ProjectMemberUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: ProjectMemberUpdateManyWithWhereWithoutUserInput | ProjectMemberUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: ProjectMemberScalarWhereInput | ProjectMemberScalarWhereInput[]
  }

  export type MarketplaceAssetUncheckedUpdateManyWithoutAuthorNestedInput = {
    create?: XOR<MarketplaceAssetCreateWithoutAuthorInput, MarketplaceAssetUncheckedCreateWithoutAuthorInput> | MarketplaceAssetCreateWithoutAuthorInput[] | MarketplaceAssetUncheckedCreateWithoutAuthorInput[]
    connectOrCreate?: MarketplaceAssetCreateOrConnectWithoutAuthorInput | MarketplaceAssetCreateOrConnectWithoutAuthorInput[]
    upsert?: MarketplaceAssetUpsertWithWhereUniqueWithoutAuthorInput | MarketplaceAssetUpsertWithWhereUniqueWithoutAuthorInput[]
    createMany?: MarketplaceAssetCreateManyAuthorInputEnvelope
    set?: MarketplaceAssetWhereUniqueInput | MarketplaceAssetWhereUniqueInput[]
    disconnect?: MarketplaceAssetWhereUniqueInput | MarketplaceAssetWhereUniqueInput[]
    delete?: MarketplaceAssetWhereUniqueInput | MarketplaceAssetWhereUniqueInput[]
    connect?: MarketplaceAssetWhereUniqueInput | MarketplaceAssetWhereUniqueInput[]
    update?: MarketplaceAssetUpdateWithWhereUniqueWithoutAuthorInput | MarketplaceAssetUpdateWithWhereUniqueWithoutAuthorInput[]
    updateMany?: MarketplaceAssetUpdateManyWithWhereWithoutAuthorInput | MarketplaceAssetUpdateManyWithWhereWithoutAuthorInput[]
    deleteMany?: MarketplaceAssetScalarWhereInput | MarketplaceAssetScalarWhereInput[]
  }

  export type ProjectCloneUncheckedUpdateManyWithoutClonedByNestedInput = {
    create?: XOR<ProjectCloneCreateWithoutClonedByInput, ProjectCloneUncheckedCreateWithoutClonedByInput> | ProjectCloneCreateWithoutClonedByInput[] | ProjectCloneUncheckedCreateWithoutClonedByInput[]
    connectOrCreate?: ProjectCloneCreateOrConnectWithoutClonedByInput | ProjectCloneCreateOrConnectWithoutClonedByInput[]
    upsert?: ProjectCloneUpsertWithWhereUniqueWithoutClonedByInput | ProjectCloneUpsertWithWhereUniqueWithoutClonedByInput[]
    createMany?: ProjectCloneCreateManyClonedByInputEnvelope
    set?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    disconnect?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    delete?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    connect?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    update?: ProjectCloneUpdateWithWhereUniqueWithoutClonedByInput | ProjectCloneUpdateWithWhereUniqueWithoutClonedByInput[]
    updateMany?: ProjectCloneUpdateManyWithWhereWithoutClonedByInput | ProjectCloneUpdateManyWithWhereWithoutClonedByInput[]
    deleteMany?: ProjectCloneScalarWhereInput | ProjectCloneScalarWhereInput[]
  }

  export type UserCreateNestedOneWithoutOnboardingProgressInput = {
    create?: XOR<UserCreateWithoutOnboardingProgressInput, UserUncheckedCreateWithoutOnboardingProgressInput>
    connectOrCreate?: UserCreateOrConnectWithoutOnboardingProgressInput
    connect?: UserWhereUniqueInput
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type UserUpdateOneRequiredWithoutOnboardingProgressNestedInput = {
    create?: XOR<UserCreateWithoutOnboardingProgressInput, UserUncheckedCreateWithoutOnboardingProgressInput>
    connectOrCreate?: UserCreateOrConnectWithoutOnboardingProgressInput
    upsert?: UserUpsertWithoutOnboardingProgressInput
    connect?: UserWhereUniqueInput
    update?: XOR<XOR<UserUpdateToOneWithWhereWithoutOnboardingProgressInput, UserUpdateWithoutOnboardingProgressInput>, UserUncheckedUpdateWithoutOnboardingProgressInput>
  }

  export type OrganizationMemberCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<OrganizationMemberCreateWithoutOrganizationInput, OrganizationMemberUncheckedCreateWithoutOrganizationInput> | OrganizationMemberCreateWithoutOrganizationInput[] | OrganizationMemberUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: OrganizationMemberCreateOrConnectWithoutOrganizationInput | OrganizationMemberCreateOrConnectWithoutOrganizationInput[]
    createMany?: OrganizationMemberCreateManyOrganizationInputEnvelope
    connect?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
  }

  export type TeamCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<TeamCreateWithoutOrganizationInput, TeamUncheckedCreateWithoutOrganizationInput> | TeamCreateWithoutOrganizationInput[] | TeamUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: TeamCreateOrConnectWithoutOrganizationInput | TeamCreateOrConnectWithoutOrganizationInput[]
    createMany?: TeamCreateManyOrganizationInputEnvelope
    connect?: TeamWhereUniqueInput | TeamWhereUniqueInput[]
  }

  export type OrganizationInviteTokenCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<OrganizationInviteTokenCreateWithoutOrganizationInput, OrganizationInviteTokenUncheckedCreateWithoutOrganizationInput> | OrganizationInviteTokenCreateWithoutOrganizationInput[] | OrganizationInviteTokenUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: OrganizationInviteTokenCreateOrConnectWithoutOrganizationInput | OrganizationInviteTokenCreateOrConnectWithoutOrganizationInput[]
    createMany?: OrganizationInviteTokenCreateManyOrganizationInputEnvelope
    connect?: OrganizationInviteTokenWhereUniqueInput | OrganizationInviteTokenWhereUniqueInput[]
  }

  export type OrganizationMemberUncheckedCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<OrganizationMemberCreateWithoutOrganizationInput, OrganizationMemberUncheckedCreateWithoutOrganizationInput> | OrganizationMemberCreateWithoutOrganizationInput[] | OrganizationMemberUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: OrganizationMemberCreateOrConnectWithoutOrganizationInput | OrganizationMemberCreateOrConnectWithoutOrganizationInput[]
    createMany?: OrganizationMemberCreateManyOrganizationInputEnvelope
    connect?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
  }

  export type TeamUncheckedCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<TeamCreateWithoutOrganizationInput, TeamUncheckedCreateWithoutOrganizationInput> | TeamCreateWithoutOrganizationInput[] | TeamUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: TeamCreateOrConnectWithoutOrganizationInput | TeamCreateOrConnectWithoutOrganizationInput[]
    createMany?: TeamCreateManyOrganizationInputEnvelope
    connect?: TeamWhereUniqueInput | TeamWhereUniqueInput[]
  }

  export type OrganizationInviteTokenUncheckedCreateNestedManyWithoutOrganizationInput = {
    create?: XOR<OrganizationInviteTokenCreateWithoutOrganizationInput, OrganizationInviteTokenUncheckedCreateWithoutOrganizationInput> | OrganizationInviteTokenCreateWithoutOrganizationInput[] | OrganizationInviteTokenUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: OrganizationInviteTokenCreateOrConnectWithoutOrganizationInput | OrganizationInviteTokenCreateOrConnectWithoutOrganizationInput[]
    createMany?: OrganizationInviteTokenCreateManyOrganizationInputEnvelope
    connect?: OrganizationInviteTokenWhereUniqueInput | OrganizationInviteTokenWhereUniqueInput[]
  }

  export type EnumOrgStatusFieldUpdateOperationsInput = {
    set?: $Enums.OrgStatus
  }

  export type OrganizationMemberUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<OrganizationMemberCreateWithoutOrganizationInput, OrganizationMemberUncheckedCreateWithoutOrganizationInput> | OrganizationMemberCreateWithoutOrganizationInput[] | OrganizationMemberUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: OrganizationMemberCreateOrConnectWithoutOrganizationInput | OrganizationMemberCreateOrConnectWithoutOrganizationInput[]
    upsert?: OrganizationMemberUpsertWithWhereUniqueWithoutOrganizationInput | OrganizationMemberUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: OrganizationMemberCreateManyOrganizationInputEnvelope
    set?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    disconnect?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    delete?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    connect?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    update?: OrganizationMemberUpdateWithWhereUniqueWithoutOrganizationInput | OrganizationMemberUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: OrganizationMemberUpdateManyWithWhereWithoutOrganizationInput | OrganizationMemberUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: OrganizationMemberScalarWhereInput | OrganizationMemberScalarWhereInput[]
  }

  export type TeamUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<TeamCreateWithoutOrganizationInput, TeamUncheckedCreateWithoutOrganizationInput> | TeamCreateWithoutOrganizationInput[] | TeamUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: TeamCreateOrConnectWithoutOrganizationInput | TeamCreateOrConnectWithoutOrganizationInput[]
    upsert?: TeamUpsertWithWhereUniqueWithoutOrganizationInput | TeamUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: TeamCreateManyOrganizationInputEnvelope
    set?: TeamWhereUniqueInput | TeamWhereUniqueInput[]
    disconnect?: TeamWhereUniqueInput | TeamWhereUniqueInput[]
    delete?: TeamWhereUniqueInput | TeamWhereUniqueInput[]
    connect?: TeamWhereUniqueInput | TeamWhereUniqueInput[]
    update?: TeamUpdateWithWhereUniqueWithoutOrganizationInput | TeamUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: TeamUpdateManyWithWhereWithoutOrganizationInput | TeamUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: TeamScalarWhereInput | TeamScalarWhereInput[]
  }

  export type OrganizationInviteTokenUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<OrganizationInviteTokenCreateWithoutOrganizationInput, OrganizationInviteTokenUncheckedCreateWithoutOrganizationInput> | OrganizationInviteTokenCreateWithoutOrganizationInput[] | OrganizationInviteTokenUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: OrganizationInviteTokenCreateOrConnectWithoutOrganizationInput | OrganizationInviteTokenCreateOrConnectWithoutOrganizationInput[]
    upsert?: OrganizationInviteTokenUpsertWithWhereUniqueWithoutOrganizationInput | OrganizationInviteTokenUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: OrganizationInviteTokenCreateManyOrganizationInputEnvelope
    set?: OrganizationInviteTokenWhereUniqueInput | OrganizationInviteTokenWhereUniqueInput[]
    disconnect?: OrganizationInviteTokenWhereUniqueInput | OrganizationInviteTokenWhereUniqueInput[]
    delete?: OrganizationInviteTokenWhereUniqueInput | OrganizationInviteTokenWhereUniqueInput[]
    connect?: OrganizationInviteTokenWhereUniqueInput | OrganizationInviteTokenWhereUniqueInput[]
    update?: OrganizationInviteTokenUpdateWithWhereUniqueWithoutOrganizationInput | OrganizationInviteTokenUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: OrganizationInviteTokenUpdateManyWithWhereWithoutOrganizationInput | OrganizationInviteTokenUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: OrganizationInviteTokenScalarWhereInput | OrganizationInviteTokenScalarWhereInput[]
  }

  export type OrganizationMemberUncheckedUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<OrganizationMemberCreateWithoutOrganizationInput, OrganizationMemberUncheckedCreateWithoutOrganizationInput> | OrganizationMemberCreateWithoutOrganizationInput[] | OrganizationMemberUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: OrganizationMemberCreateOrConnectWithoutOrganizationInput | OrganizationMemberCreateOrConnectWithoutOrganizationInput[]
    upsert?: OrganizationMemberUpsertWithWhereUniqueWithoutOrganizationInput | OrganizationMemberUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: OrganizationMemberCreateManyOrganizationInputEnvelope
    set?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    disconnect?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    delete?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    connect?: OrganizationMemberWhereUniqueInput | OrganizationMemberWhereUniqueInput[]
    update?: OrganizationMemberUpdateWithWhereUniqueWithoutOrganizationInput | OrganizationMemberUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: OrganizationMemberUpdateManyWithWhereWithoutOrganizationInput | OrganizationMemberUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: OrganizationMemberScalarWhereInput | OrganizationMemberScalarWhereInput[]
  }

  export type TeamUncheckedUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<TeamCreateWithoutOrganizationInput, TeamUncheckedCreateWithoutOrganizationInput> | TeamCreateWithoutOrganizationInput[] | TeamUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: TeamCreateOrConnectWithoutOrganizationInput | TeamCreateOrConnectWithoutOrganizationInput[]
    upsert?: TeamUpsertWithWhereUniqueWithoutOrganizationInput | TeamUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: TeamCreateManyOrganizationInputEnvelope
    set?: TeamWhereUniqueInput | TeamWhereUniqueInput[]
    disconnect?: TeamWhereUniqueInput | TeamWhereUniqueInput[]
    delete?: TeamWhereUniqueInput | TeamWhereUniqueInput[]
    connect?: TeamWhereUniqueInput | TeamWhereUniqueInput[]
    update?: TeamUpdateWithWhereUniqueWithoutOrganizationInput | TeamUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: TeamUpdateManyWithWhereWithoutOrganizationInput | TeamUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: TeamScalarWhereInput | TeamScalarWhereInput[]
  }

  export type OrganizationInviteTokenUncheckedUpdateManyWithoutOrganizationNestedInput = {
    create?: XOR<OrganizationInviteTokenCreateWithoutOrganizationInput, OrganizationInviteTokenUncheckedCreateWithoutOrganizationInput> | OrganizationInviteTokenCreateWithoutOrganizationInput[] | OrganizationInviteTokenUncheckedCreateWithoutOrganizationInput[]
    connectOrCreate?: OrganizationInviteTokenCreateOrConnectWithoutOrganizationInput | OrganizationInviteTokenCreateOrConnectWithoutOrganizationInput[]
    upsert?: OrganizationInviteTokenUpsertWithWhereUniqueWithoutOrganizationInput | OrganizationInviteTokenUpsertWithWhereUniqueWithoutOrganizationInput[]
    createMany?: OrganizationInviteTokenCreateManyOrganizationInputEnvelope
    set?: OrganizationInviteTokenWhereUniqueInput | OrganizationInviteTokenWhereUniqueInput[]
    disconnect?: OrganizationInviteTokenWhereUniqueInput | OrganizationInviteTokenWhereUniqueInput[]
    delete?: OrganizationInviteTokenWhereUniqueInput | OrganizationInviteTokenWhereUniqueInput[]
    connect?: OrganizationInviteTokenWhereUniqueInput | OrganizationInviteTokenWhereUniqueInput[]
    update?: OrganizationInviteTokenUpdateWithWhereUniqueWithoutOrganizationInput | OrganizationInviteTokenUpdateWithWhereUniqueWithoutOrganizationInput[]
    updateMany?: OrganizationInviteTokenUpdateManyWithWhereWithoutOrganizationInput | OrganizationInviteTokenUpdateManyWithWhereWithoutOrganizationInput[]
    deleteMany?: OrganizationInviteTokenScalarWhereInput | OrganizationInviteTokenScalarWhereInput[]
  }

  export type OrganizationCreateNestedOneWithoutMembersInput = {
    create?: XOR<OrganizationCreateWithoutMembersInput, OrganizationUncheckedCreateWithoutMembersInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutMembersInput
    connect?: OrganizationWhereUniqueInput
  }

  export type UserCreateNestedOneWithoutOrganizationsInput = {
    create?: XOR<UserCreateWithoutOrganizationsInput, UserUncheckedCreateWithoutOrganizationsInput>
    connectOrCreate?: UserCreateOrConnectWithoutOrganizationsInput
    connect?: UserWhereUniqueInput
  }

  export type EnumOrgRoleFieldUpdateOperationsInput = {
    set?: $Enums.OrgRole
  }

  export type OrganizationUpdateOneRequiredWithoutMembersNestedInput = {
    create?: XOR<OrganizationCreateWithoutMembersInput, OrganizationUncheckedCreateWithoutMembersInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutMembersInput
    upsert?: OrganizationUpsertWithoutMembersInput
    connect?: OrganizationWhereUniqueInput
    update?: XOR<XOR<OrganizationUpdateToOneWithWhereWithoutMembersInput, OrganizationUpdateWithoutMembersInput>, OrganizationUncheckedUpdateWithoutMembersInput>
  }

  export type UserUpdateOneRequiredWithoutOrganizationsNestedInput = {
    create?: XOR<UserCreateWithoutOrganizationsInput, UserUncheckedCreateWithoutOrganizationsInput>
    connectOrCreate?: UserCreateOrConnectWithoutOrganizationsInput
    upsert?: UserUpsertWithoutOrganizationsInput
    connect?: UserWhereUniqueInput
    update?: XOR<XOR<UserUpdateToOneWithWhereWithoutOrganizationsInput, UserUpdateWithoutOrganizationsInput>, UserUncheckedUpdateWithoutOrganizationsInput>
  }

  export type OrganizationCreateNestedOneWithoutInviteTokensInput = {
    create?: XOR<OrganizationCreateWithoutInviteTokensInput, OrganizationUncheckedCreateWithoutInviteTokensInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutInviteTokensInput
    connect?: OrganizationWhereUniqueInput
  }

  export type OrganizationUpdateOneRequiredWithoutInviteTokensNestedInput = {
    create?: XOR<OrganizationCreateWithoutInviteTokensInput, OrganizationUncheckedCreateWithoutInviteTokensInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutInviteTokensInput
    upsert?: OrganizationUpsertWithoutInviteTokensInput
    connect?: OrganizationWhereUniqueInput
    update?: XOR<XOR<OrganizationUpdateToOneWithWhereWithoutInviteTokensInput, OrganizationUpdateWithoutInviteTokensInput>, OrganizationUncheckedUpdateWithoutInviteTokensInput>
  }

  export type OrganizationCreateNestedOneWithoutTeamsInput = {
    create?: XOR<OrganizationCreateWithoutTeamsInput, OrganizationUncheckedCreateWithoutTeamsInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutTeamsInput
    connect?: OrganizationWhereUniqueInput
  }

  export type TeamMemberCreateNestedManyWithoutTeamInput = {
    create?: XOR<TeamMemberCreateWithoutTeamInput, TeamMemberUncheckedCreateWithoutTeamInput> | TeamMemberCreateWithoutTeamInput[] | TeamMemberUncheckedCreateWithoutTeamInput[]
    connectOrCreate?: TeamMemberCreateOrConnectWithoutTeamInput | TeamMemberCreateOrConnectWithoutTeamInput[]
    createMany?: TeamMemberCreateManyTeamInputEnvelope
    connect?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
  }

  export type ProjectCreateNestedManyWithoutTeamInput = {
    create?: XOR<ProjectCreateWithoutTeamInput, ProjectUncheckedCreateWithoutTeamInput> | ProjectCreateWithoutTeamInput[] | ProjectUncheckedCreateWithoutTeamInput[]
    connectOrCreate?: ProjectCreateOrConnectWithoutTeamInput | ProjectCreateOrConnectWithoutTeamInput[]
    createMany?: ProjectCreateManyTeamInputEnvelope
    connect?: ProjectWhereUniqueInput | ProjectWhereUniqueInput[]
  }

  export type TeamMemberUncheckedCreateNestedManyWithoutTeamInput = {
    create?: XOR<TeamMemberCreateWithoutTeamInput, TeamMemberUncheckedCreateWithoutTeamInput> | TeamMemberCreateWithoutTeamInput[] | TeamMemberUncheckedCreateWithoutTeamInput[]
    connectOrCreate?: TeamMemberCreateOrConnectWithoutTeamInput | TeamMemberCreateOrConnectWithoutTeamInput[]
    createMany?: TeamMemberCreateManyTeamInputEnvelope
    connect?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
  }

  export type ProjectUncheckedCreateNestedManyWithoutTeamInput = {
    create?: XOR<ProjectCreateWithoutTeamInput, ProjectUncheckedCreateWithoutTeamInput> | ProjectCreateWithoutTeamInput[] | ProjectUncheckedCreateWithoutTeamInput[]
    connectOrCreate?: ProjectCreateOrConnectWithoutTeamInput | ProjectCreateOrConnectWithoutTeamInput[]
    createMany?: ProjectCreateManyTeamInputEnvelope
    connect?: ProjectWhereUniqueInput | ProjectWhereUniqueInput[]
  }

  export type OrganizationUpdateOneRequiredWithoutTeamsNestedInput = {
    create?: XOR<OrganizationCreateWithoutTeamsInput, OrganizationUncheckedCreateWithoutTeamsInput>
    connectOrCreate?: OrganizationCreateOrConnectWithoutTeamsInput
    upsert?: OrganizationUpsertWithoutTeamsInput
    connect?: OrganizationWhereUniqueInput
    update?: XOR<XOR<OrganizationUpdateToOneWithWhereWithoutTeamsInput, OrganizationUpdateWithoutTeamsInput>, OrganizationUncheckedUpdateWithoutTeamsInput>
  }

  export type TeamMemberUpdateManyWithoutTeamNestedInput = {
    create?: XOR<TeamMemberCreateWithoutTeamInput, TeamMemberUncheckedCreateWithoutTeamInput> | TeamMemberCreateWithoutTeamInput[] | TeamMemberUncheckedCreateWithoutTeamInput[]
    connectOrCreate?: TeamMemberCreateOrConnectWithoutTeamInput | TeamMemberCreateOrConnectWithoutTeamInput[]
    upsert?: TeamMemberUpsertWithWhereUniqueWithoutTeamInput | TeamMemberUpsertWithWhereUniqueWithoutTeamInput[]
    createMany?: TeamMemberCreateManyTeamInputEnvelope
    set?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    disconnect?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    delete?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    connect?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    update?: TeamMemberUpdateWithWhereUniqueWithoutTeamInput | TeamMemberUpdateWithWhereUniqueWithoutTeamInput[]
    updateMany?: TeamMemberUpdateManyWithWhereWithoutTeamInput | TeamMemberUpdateManyWithWhereWithoutTeamInput[]
    deleteMany?: TeamMemberScalarWhereInput | TeamMemberScalarWhereInput[]
  }

  export type ProjectUpdateManyWithoutTeamNestedInput = {
    create?: XOR<ProjectCreateWithoutTeamInput, ProjectUncheckedCreateWithoutTeamInput> | ProjectCreateWithoutTeamInput[] | ProjectUncheckedCreateWithoutTeamInput[]
    connectOrCreate?: ProjectCreateOrConnectWithoutTeamInput | ProjectCreateOrConnectWithoutTeamInput[]
    upsert?: ProjectUpsertWithWhereUniqueWithoutTeamInput | ProjectUpsertWithWhereUniqueWithoutTeamInput[]
    createMany?: ProjectCreateManyTeamInputEnvelope
    set?: ProjectWhereUniqueInput | ProjectWhereUniqueInput[]
    disconnect?: ProjectWhereUniqueInput | ProjectWhereUniqueInput[]
    delete?: ProjectWhereUniqueInput | ProjectWhereUniqueInput[]
    connect?: ProjectWhereUniqueInput | ProjectWhereUniqueInput[]
    update?: ProjectUpdateWithWhereUniqueWithoutTeamInput | ProjectUpdateWithWhereUniqueWithoutTeamInput[]
    updateMany?: ProjectUpdateManyWithWhereWithoutTeamInput | ProjectUpdateManyWithWhereWithoutTeamInput[]
    deleteMany?: ProjectScalarWhereInput | ProjectScalarWhereInput[]
  }

  export type TeamMemberUncheckedUpdateManyWithoutTeamNestedInput = {
    create?: XOR<TeamMemberCreateWithoutTeamInput, TeamMemberUncheckedCreateWithoutTeamInput> | TeamMemberCreateWithoutTeamInput[] | TeamMemberUncheckedCreateWithoutTeamInput[]
    connectOrCreate?: TeamMemberCreateOrConnectWithoutTeamInput | TeamMemberCreateOrConnectWithoutTeamInput[]
    upsert?: TeamMemberUpsertWithWhereUniqueWithoutTeamInput | TeamMemberUpsertWithWhereUniqueWithoutTeamInput[]
    createMany?: TeamMemberCreateManyTeamInputEnvelope
    set?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    disconnect?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    delete?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    connect?: TeamMemberWhereUniqueInput | TeamMemberWhereUniqueInput[]
    update?: TeamMemberUpdateWithWhereUniqueWithoutTeamInput | TeamMemberUpdateWithWhereUniqueWithoutTeamInput[]
    updateMany?: TeamMemberUpdateManyWithWhereWithoutTeamInput | TeamMemberUpdateManyWithWhereWithoutTeamInput[]
    deleteMany?: TeamMemberScalarWhereInput | TeamMemberScalarWhereInput[]
  }

  export type ProjectUncheckedUpdateManyWithoutTeamNestedInput = {
    create?: XOR<ProjectCreateWithoutTeamInput, ProjectUncheckedCreateWithoutTeamInput> | ProjectCreateWithoutTeamInput[] | ProjectUncheckedCreateWithoutTeamInput[]
    connectOrCreate?: ProjectCreateOrConnectWithoutTeamInput | ProjectCreateOrConnectWithoutTeamInput[]
    upsert?: ProjectUpsertWithWhereUniqueWithoutTeamInput | ProjectUpsertWithWhereUniqueWithoutTeamInput[]
    createMany?: ProjectCreateManyTeamInputEnvelope
    set?: ProjectWhereUniqueInput | ProjectWhereUniqueInput[]
    disconnect?: ProjectWhereUniqueInput | ProjectWhereUniqueInput[]
    delete?: ProjectWhereUniqueInput | ProjectWhereUniqueInput[]
    connect?: ProjectWhereUniqueInput | ProjectWhereUniqueInput[]
    update?: ProjectUpdateWithWhereUniqueWithoutTeamInput | ProjectUpdateWithWhereUniqueWithoutTeamInput[]
    updateMany?: ProjectUpdateManyWithWhereWithoutTeamInput | ProjectUpdateManyWithWhereWithoutTeamInput[]
    deleteMany?: ProjectScalarWhereInput | ProjectScalarWhereInput[]
  }

  export type TeamCreateNestedOneWithoutMembersInput = {
    create?: XOR<TeamCreateWithoutMembersInput, TeamUncheckedCreateWithoutMembersInput>
    connectOrCreate?: TeamCreateOrConnectWithoutMembersInput
    connect?: TeamWhereUniqueInput
  }

  export type UserCreateNestedOneWithoutTeamMembershipsInput = {
    create?: XOR<UserCreateWithoutTeamMembershipsInput, UserUncheckedCreateWithoutTeamMembershipsInput>
    connectOrCreate?: UserCreateOrConnectWithoutTeamMembershipsInput
    connect?: UserWhereUniqueInput
  }

  export type TeamUpdateOneRequiredWithoutMembersNestedInput = {
    create?: XOR<TeamCreateWithoutMembersInput, TeamUncheckedCreateWithoutMembersInput>
    connectOrCreate?: TeamCreateOrConnectWithoutMembersInput
    upsert?: TeamUpsertWithoutMembersInput
    connect?: TeamWhereUniqueInput
    update?: XOR<XOR<TeamUpdateToOneWithWhereWithoutMembersInput, TeamUpdateWithoutMembersInput>, TeamUncheckedUpdateWithoutMembersInput>
  }

  export type UserUpdateOneRequiredWithoutTeamMembershipsNestedInput = {
    create?: XOR<UserCreateWithoutTeamMembershipsInput, UserUncheckedCreateWithoutTeamMembershipsInput>
    connectOrCreate?: UserCreateOrConnectWithoutTeamMembershipsInput
    upsert?: UserUpsertWithoutTeamMembershipsInput
    connect?: UserWhereUniqueInput
    update?: XOR<XOR<UserUpdateToOneWithWhereWithoutTeamMembershipsInput, UserUpdateWithoutTeamMembershipsInput>, UserUncheckedUpdateWithoutTeamMembershipsInput>
  }

  export type TeamCreateNestedOneWithoutProjectsInput = {
    create?: XOR<TeamCreateWithoutProjectsInput, TeamUncheckedCreateWithoutProjectsInput>
    connectOrCreate?: TeamCreateOrConnectWithoutProjectsInput
    connect?: TeamWhereUniqueInput
  }

  export type ProjectMemberCreateNestedManyWithoutProjectInput = {
    create?: XOR<ProjectMemberCreateWithoutProjectInput, ProjectMemberUncheckedCreateWithoutProjectInput> | ProjectMemberCreateWithoutProjectInput[] | ProjectMemberUncheckedCreateWithoutProjectInput[]
    connectOrCreate?: ProjectMemberCreateOrConnectWithoutProjectInput | ProjectMemberCreateOrConnectWithoutProjectInput[]
    createMany?: ProjectMemberCreateManyProjectInputEnvelope
    connect?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
  }

  export type MarketplaceAssetCreateNestedOneWithoutProjectInput = {
    create?: XOR<MarketplaceAssetCreateWithoutProjectInput, MarketplaceAssetUncheckedCreateWithoutProjectInput>
    connectOrCreate?: MarketplaceAssetCreateOrConnectWithoutProjectInput
    connect?: MarketplaceAssetWhereUniqueInput
  }

  export type ProjectCloneCreateNestedOneWithoutClonedProjectInput = {
    create?: XOR<ProjectCloneCreateWithoutClonedProjectInput, ProjectCloneUncheckedCreateWithoutClonedProjectInput>
    connectOrCreate?: ProjectCloneCreateOrConnectWithoutClonedProjectInput
    connect?: ProjectCloneWhereUniqueInput
  }

  export type ProjectMemberUncheckedCreateNestedManyWithoutProjectInput = {
    create?: XOR<ProjectMemberCreateWithoutProjectInput, ProjectMemberUncheckedCreateWithoutProjectInput> | ProjectMemberCreateWithoutProjectInput[] | ProjectMemberUncheckedCreateWithoutProjectInput[]
    connectOrCreate?: ProjectMemberCreateOrConnectWithoutProjectInput | ProjectMemberCreateOrConnectWithoutProjectInput[]
    createMany?: ProjectMemberCreateManyProjectInputEnvelope
    connect?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
  }

  export type MarketplaceAssetUncheckedCreateNestedOneWithoutProjectInput = {
    create?: XOR<MarketplaceAssetCreateWithoutProjectInput, MarketplaceAssetUncheckedCreateWithoutProjectInput>
    connectOrCreate?: MarketplaceAssetCreateOrConnectWithoutProjectInput
    connect?: MarketplaceAssetWhereUniqueInput
  }

  export type ProjectCloneUncheckedCreateNestedOneWithoutClonedProjectInput = {
    create?: XOR<ProjectCloneCreateWithoutClonedProjectInput, ProjectCloneUncheckedCreateWithoutClonedProjectInput>
    connectOrCreate?: ProjectCloneCreateOrConnectWithoutClonedProjectInput
    connect?: ProjectCloneWhereUniqueInput
  }

  export type TeamUpdateOneRequiredWithoutProjectsNestedInput = {
    create?: XOR<TeamCreateWithoutProjectsInput, TeamUncheckedCreateWithoutProjectsInput>
    connectOrCreate?: TeamCreateOrConnectWithoutProjectsInput
    upsert?: TeamUpsertWithoutProjectsInput
    connect?: TeamWhereUniqueInput
    update?: XOR<XOR<TeamUpdateToOneWithWhereWithoutProjectsInput, TeamUpdateWithoutProjectsInput>, TeamUncheckedUpdateWithoutProjectsInput>
  }

  export type ProjectMemberUpdateManyWithoutProjectNestedInput = {
    create?: XOR<ProjectMemberCreateWithoutProjectInput, ProjectMemberUncheckedCreateWithoutProjectInput> | ProjectMemberCreateWithoutProjectInput[] | ProjectMemberUncheckedCreateWithoutProjectInput[]
    connectOrCreate?: ProjectMemberCreateOrConnectWithoutProjectInput | ProjectMemberCreateOrConnectWithoutProjectInput[]
    upsert?: ProjectMemberUpsertWithWhereUniqueWithoutProjectInput | ProjectMemberUpsertWithWhereUniqueWithoutProjectInput[]
    createMany?: ProjectMemberCreateManyProjectInputEnvelope
    set?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    disconnect?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    delete?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    connect?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    update?: ProjectMemberUpdateWithWhereUniqueWithoutProjectInput | ProjectMemberUpdateWithWhereUniqueWithoutProjectInput[]
    updateMany?: ProjectMemberUpdateManyWithWhereWithoutProjectInput | ProjectMemberUpdateManyWithWhereWithoutProjectInput[]
    deleteMany?: ProjectMemberScalarWhereInput | ProjectMemberScalarWhereInput[]
  }

  export type MarketplaceAssetUpdateOneWithoutProjectNestedInput = {
    create?: XOR<MarketplaceAssetCreateWithoutProjectInput, MarketplaceAssetUncheckedCreateWithoutProjectInput>
    connectOrCreate?: MarketplaceAssetCreateOrConnectWithoutProjectInput
    upsert?: MarketplaceAssetUpsertWithoutProjectInput
    disconnect?: MarketplaceAssetWhereInput | boolean
    delete?: MarketplaceAssetWhereInput | boolean
    connect?: MarketplaceAssetWhereUniqueInput
    update?: XOR<XOR<MarketplaceAssetUpdateToOneWithWhereWithoutProjectInput, MarketplaceAssetUpdateWithoutProjectInput>, MarketplaceAssetUncheckedUpdateWithoutProjectInput>
  }

  export type ProjectCloneUpdateOneWithoutClonedProjectNestedInput = {
    create?: XOR<ProjectCloneCreateWithoutClonedProjectInput, ProjectCloneUncheckedCreateWithoutClonedProjectInput>
    connectOrCreate?: ProjectCloneCreateOrConnectWithoutClonedProjectInput
    upsert?: ProjectCloneUpsertWithoutClonedProjectInput
    disconnect?: ProjectCloneWhereInput | boolean
    delete?: ProjectCloneWhereInput | boolean
    connect?: ProjectCloneWhereUniqueInput
    update?: XOR<XOR<ProjectCloneUpdateToOneWithWhereWithoutClonedProjectInput, ProjectCloneUpdateWithoutClonedProjectInput>, ProjectCloneUncheckedUpdateWithoutClonedProjectInput>
  }

  export type ProjectMemberUncheckedUpdateManyWithoutProjectNestedInput = {
    create?: XOR<ProjectMemberCreateWithoutProjectInput, ProjectMemberUncheckedCreateWithoutProjectInput> | ProjectMemberCreateWithoutProjectInput[] | ProjectMemberUncheckedCreateWithoutProjectInput[]
    connectOrCreate?: ProjectMemberCreateOrConnectWithoutProjectInput | ProjectMemberCreateOrConnectWithoutProjectInput[]
    upsert?: ProjectMemberUpsertWithWhereUniqueWithoutProjectInput | ProjectMemberUpsertWithWhereUniqueWithoutProjectInput[]
    createMany?: ProjectMemberCreateManyProjectInputEnvelope
    set?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    disconnect?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    delete?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    connect?: ProjectMemberWhereUniqueInput | ProjectMemberWhereUniqueInput[]
    update?: ProjectMemberUpdateWithWhereUniqueWithoutProjectInput | ProjectMemberUpdateWithWhereUniqueWithoutProjectInput[]
    updateMany?: ProjectMemberUpdateManyWithWhereWithoutProjectInput | ProjectMemberUpdateManyWithWhereWithoutProjectInput[]
    deleteMany?: ProjectMemberScalarWhereInput | ProjectMemberScalarWhereInput[]
  }

  export type MarketplaceAssetUncheckedUpdateOneWithoutProjectNestedInput = {
    create?: XOR<MarketplaceAssetCreateWithoutProjectInput, MarketplaceAssetUncheckedCreateWithoutProjectInput>
    connectOrCreate?: MarketplaceAssetCreateOrConnectWithoutProjectInput
    upsert?: MarketplaceAssetUpsertWithoutProjectInput
    disconnect?: MarketplaceAssetWhereInput | boolean
    delete?: MarketplaceAssetWhereInput | boolean
    connect?: MarketplaceAssetWhereUniqueInput
    update?: XOR<XOR<MarketplaceAssetUpdateToOneWithWhereWithoutProjectInput, MarketplaceAssetUpdateWithoutProjectInput>, MarketplaceAssetUncheckedUpdateWithoutProjectInput>
  }

  export type ProjectCloneUncheckedUpdateOneWithoutClonedProjectNestedInput = {
    create?: XOR<ProjectCloneCreateWithoutClonedProjectInput, ProjectCloneUncheckedCreateWithoutClonedProjectInput>
    connectOrCreate?: ProjectCloneCreateOrConnectWithoutClonedProjectInput
    upsert?: ProjectCloneUpsertWithoutClonedProjectInput
    disconnect?: ProjectCloneWhereInput | boolean
    delete?: ProjectCloneWhereInput | boolean
    connect?: ProjectCloneWhereUniqueInput
    update?: XOR<XOR<ProjectCloneUpdateToOneWithWhereWithoutClonedProjectInput, ProjectCloneUpdateWithoutClonedProjectInput>, ProjectCloneUncheckedUpdateWithoutClonedProjectInput>
  }

  export type ProjectCreateNestedOneWithoutMembersInput = {
    create?: XOR<ProjectCreateWithoutMembersInput, ProjectUncheckedCreateWithoutMembersInput>
    connectOrCreate?: ProjectCreateOrConnectWithoutMembersInput
    connect?: ProjectWhereUniqueInput
  }

  export type UserCreateNestedOneWithoutProjectMembershipsInput = {
    create?: XOR<UserCreateWithoutProjectMembershipsInput, UserUncheckedCreateWithoutProjectMembershipsInput>
    connectOrCreate?: UserCreateOrConnectWithoutProjectMembershipsInput
    connect?: UserWhereUniqueInput
  }

  export type EnumProjectRoleFieldUpdateOperationsInput = {
    set?: $Enums.ProjectRole
  }

  export type ProjectUpdateOneRequiredWithoutMembersNestedInput = {
    create?: XOR<ProjectCreateWithoutMembersInput, ProjectUncheckedCreateWithoutMembersInput>
    connectOrCreate?: ProjectCreateOrConnectWithoutMembersInput
    upsert?: ProjectUpsertWithoutMembersInput
    connect?: ProjectWhereUniqueInput
    update?: XOR<XOR<ProjectUpdateToOneWithWhereWithoutMembersInput, ProjectUpdateWithoutMembersInput>, ProjectUncheckedUpdateWithoutMembersInput>
  }

  export type UserUpdateOneRequiredWithoutProjectMembershipsNestedInput = {
    create?: XOR<UserCreateWithoutProjectMembershipsInput, UserUncheckedCreateWithoutProjectMembershipsInput>
    connectOrCreate?: UserCreateOrConnectWithoutProjectMembershipsInput
    upsert?: UserUpsertWithoutProjectMembershipsInput
    connect?: UserWhereUniqueInput
    update?: XOR<XOR<UserUpdateToOneWithWhereWithoutProjectMembershipsInput, UserUpdateWithoutProjectMembershipsInput>, UserUncheckedUpdateWithoutProjectMembershipsInput>
  }

  export type MarketplaceAssetCreatetagsInput = {
    set: string[]
  }

  export type ProjectCreateNestedOneWithoutPublishedAssetInput = {
    create?: XOR<ProjectCreateWithoutPublishedAssetInput, ProjectUncheckedCreateWithoutPublishedAssetInput>
    connectOrCreate?: ProjectCreateOrConnectWithoutPublishedAssetInput
    connect?: ProjectWhereUniqueInput
  }

  export type UserCreateNestedOneWithoutPublishedAssetsInput = {
    create?: XOR<UserCreateWithoutPublishedAssetsInput, UserUncheckedCreateWithoutPublishedAssetsInput>
    connectOrCreate?: UserCreateOrConnectWithoutPublishedAssetsInput
    connect?: UserWhereUniqueInput
  }

  export type ProjectCloneCreateNestedManyWithoutAssetInput = {
    create?: XOR<ProjectCloneCreateWithoutAssetInput, ProjectCloneUncheckedCreateWithoutAssetInput> | ProjectCloneCreateWithoutAssetInput[] | ProjectCloneUncheckedCreateWithoutAssetInput[]
    connectOrCreate?: ProjectCloneCreateOrConnectWithoutAssetInput | ProjectCloneCreateOrConnectWithoutAssetInput[]
    createMany?: ProjectCloneCreateManyAssetInputEnvelope
    connect?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
  }

  export type ProjectCloneUncheckedCreateNestedManyWithoutAssetInput = {
    create?: XOR<ProjectCloneCreateWithoutAssetInput, ProjectCloneUncheckedCreateWithoutAssetInput> | ProjectCloneCreateWithoutAssetInput[] | ProjectCloneUncheckedCreateWithoutAssetInput[]
    connectOrCreate?: ProjectCloneCreateOrConnectWithoutAssetInput | ProjectCloneCreateOrConnectWithoutAssetInput[]
    createMany?: ProjectCloneCreateManyAssetInputEnvelope
    connect?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
  }

  export type MarketplaceAssetUpdatetagsInput = {
    set?: string[]
    push?: string | string[]
  }

  export type ProjectUpdateOneRequiredWithoutPublishedAssetNestedInput = {
    create?: XOR<ProjectCreateWithoutPublishedAssetInput, ProjectUncheckedCreateWithoutPublishedAssetInput>
    connectOrCreate?: ProjectCreateOrConnectWithoutPublishedAssetInput
    upsert?: ProjectUpsertWithoutPublishedAssetInput
    connect?: ProjectWhereUniqueInput
    update?: XOR<XOR<ProjectUpdateToOneWithWhereWithoutPublishedAssetInput, ProjectUpdateWithoutPublishedAssetInput>, ProjectUncheckedUpdateWithoutPublishedAssetInput>
  }

  export type UserUpdateOneRequiredWithoutPublishedAssetsNestedInput = {
    create?: XOR<UserCreateWithoutPublishedAssetsInput, UserUncheckedCreateWithoutPublishedAssetsInput>
    connectOrCreate?: UserCreateOrConnectWithoutPublishedAssetsInput
    upsert?: UserUpsertWithoutPublishedAssetsInput
    connect?: UserWhereUniqueInput
    update?: XOR<XOR<UserUpdateToOneWithWhereWithoutPublishedAssetsInput, UserUpdateWithoutPublishedAssetsInput>, UserUncheckedUpdateWithoutPublishedAssetsInput>
  }

  export type ProjectCloneUpdateManyWithoutAssetNestedInput = {
    create?: XOR<ProjectCloneCreateWithoutAssetInput, ProjectCloneUncheckedCreateWithoutAssetInput> | ProjectCloneCreateWithoutAssetInput[] | ProjectCloneUncheckedCreateWithoutAssetInput[]
    connectOrCreate?: ProjectCloneCreateOrConnectWithoutAssetInput | ProjectCloneCreateOrConnectWithoutAssetInput[]
    upsert?: ProjectCloneUpsertWithWhereUniqueWithoutAssetInput | ProjectCloneUpsertWithWhereUniqueWithoutAssetInput[]
    createMany?: ProjectCloneCreateManyAssetInputEnvelope
    set?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    disconnect?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    delete?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    connect?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    update?: ProjectCloneUpdateWithWhereUniqueWithoutAssetInput | ProjectCloneUpdateWithWhereUniqueWithoutAssetInput[]
    updateMany?: ProjectCloneUpdateManyWithWhereWithoutAssetInput | ProjectCloneUpdateManyWithWhereWithoutAssetInput[]
    deleteMany?: ProjectCloneScalarWhereInput | ProjectCloneScalarWhereInput[]
  }

  export type ProjectCloneUncheckedUpdateManyWithoutAssetNestedInput = {
    create?: XOR<ProjectCloneCreateWithoutAssetInput, ProjectCloneUncheckedCreateWithoutAssetInput> | ProjectCloneCreateWithoutAssetInput[] | ProjectCloneUncheckedCreateWithoutAssetInput[]
    connectOrCreate?: ProjectCloneCreateOrConnectWithoutAssetInput | ProjectCloneCreateOrConnectWithoutAssetInput[]
    upsert?: ProjectCloneUpsertWithWhereUniqueWithoutAssetInput | ProjectCloneUpsertWithWhereUniqueWithoutAssetInput[]
    createMany?: ProjectCloneCreateManyAssetInputEnvelope
    set?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    disconnect?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    delete?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    connect?: ProjectCloneWhereUniqueInput | ProjectCloneWhereUniqueInput[]
    update?: ProjectCloneUpdateWithWhereUniqueWithoutAssetInput | ProjectCloneUpdateWithWhereUniqueWithoutAssetInput[]
    updateMany?: ProjectCloneUpdateManyWithWhereWithoutAssetInput | ProjectCloneUpdateManyWithWhereWithoutAssetInput[]
    deleteMany?: ProjectCloneScalarWhereInput | ProjectCloneScalarWhereInput[]
  }

  export type MarketplaceAssetCreateNestedOneWithoutClonesInput = {
    create?: XOR<MarketplaceAssetCreateWithoutClonesInput, MarketplaceAssetUncheckedCreateWithoutClonesInput>
    connectOrCreate?: MarketplaceAssetCreateOrConnectWithoutClonesInput
    connect?: MarketplaceAssetWhereUniqueInput
  }

  export type ProjectCreateNestedOneWithoutClonedFromInput = {
    create?: XOR<ProjectCreateWithoutClonedFromInput, ProjectUncheckedCreateWithoutClonedFromInput>
    connectOrCreate?: ProjectCreateOrConnectWithoutClonedFromInput
    connect?: ProjectWhereUniqueInput
  }

  export type UserCreateNestedOneWithoutClonedProjectsInput = {
    create?: XOR<UserCreateWithoutClonedProjectsInput, UserUncheckedCreateWithoutClonedProjectsInput>
    connectOrCreate?: UserCreateOrConnectWithoutClonedProjectsInput
    connect?: UserWhereUniqueInput
  }

  export type MarketplaceAssetUpdateOneRequiredWithoutClonesNestedInput = {
    create?: XOR<MarketplaceAssetCreateWithoutClonesInput, MarketplaceAssetUncheckedCreateWithoutClonesInput>
    connectOrCreate?: MarketplaceAssetCreateOrConnectWithoutClonesInput
    upsert?: MarketplaceAssetUpsertWithoutClonesInput
    connect?: MarketplaceAssetWhereUniqueInput
    update?: XOR<XOR<MarketplaceAssetUpdateToOneWithWhereWithoutClonesInput, MarketplaceAssetUpdateWithoutClonesInput>, MarketplaceAssetUncheckedUpdateWithoutClonesInput>
  }

  export type ProjectUpdateOneRequiredWithoutClonedFromNestedInput = {
    create?: XOR<ProjectCreateWithoutClonedFromInput, ProjectUncheckedCreateWithoutClonedFromInput>
    connectOrCreate?: ProjectCreateOrConnectWithoutClonedFromInput
    upsert?: ProjectUpsertWithoutClonedFromInput
    connect?: ProjectWhereUniqueInput
    update?: XOR<XOR<ProjectUpdateToOneWithWhereWithoutClonedFromInput, ProjectUpdateWithoutClonedFromInput>, ProjectUncheckedUpdateWithoutClonedFromInput>
  }

  export type UserUpdateOneRequiredWithoutClonedProjectsNestedInput = {
    create?: XOR<UserCreateWithoutClonedProjectsInput, UserUncheckedCreateWithoutClonedProjectsInput>
    connectOrCreate?: UserCreateOrConnectWithoutClonedProjectsInput
    upsert?: UserUpsertWithoutClonedProjectsInput
    connect?: UserWhereUniqueInput
    update?: XOR<XOR<UserUpdateToOneWithWhereWithoutClonedProjectsInput, UserUpdateWithoutClonedProjectsInput>, UserUncheckedUpdateWithoutClonedProjectsInput>
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedDateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type NestedBoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedDateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel> | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type NestedBoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type NestedIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type NestedFloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }
  export type NestedJsonFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<NestedJsonFilterBase<$PrismaModel>>, Exclude<keyof Required<NestedJsonFilterBase<$PrismaModel>>, 'path'>>,
        Required<NestedJsonFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<NestedJsonFilterBase<$PrismaModel>>, 'path'>>

  export type NestedJsonFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type NestedEnumOrgStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.OrgStatus | EnumOrgStatusFieldRefInput<$PrismaModel>
    in?: $Enums.OrgStatus[] | ListEnumOrgStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.OrgStatus[] | ListEnumOrgStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumOrgStatusFilter<$PrismaModel> | $Enums.OrgStatus
  }

  export type NestedEnumOrgStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.OrgStatus | EnumOrgStatusFieldRefInput<$PrismaModel>
    in?: $Enums.OrgStatus[] | ListEnumOrgStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.OrgStatus[] | ListEnumOrgStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumOrgStatusWithAggregatesFilter<$PrismaModel> | $Enums.OrgStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumOrgStatusFilter<$PrismaModel>
    _max?: NestedEnumOrgStatusFilter<$PrismaModel>
  }

  export type NestedEnumOrgRoleFilter<$PrismaModel = never> = {
    equals?: $Enums.OrgRole | EnumOrgRoleFieldRefInput<$PrismaModel>
    in?: $Enums.OrgRole[] | ListEnumOrgRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.OrgRole[] | ListEnumOrgRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumOrgRoleFilter<$PrismaModel> | $Enums.OrgRole
  }

  export type NestedEnumOrgRoleWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.OrgRole | EnumOrgRoleFieldRefInput<$PrismaModel>
    in?: $Enums.OrgRole[] | ListEnumOrgRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.OrgRole[] | ListEnumOrgRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumOrgRoleWithAggregatesFilter<$PrismaModel> | $Enums.OrgRole
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumOrgRoleFilter<$PrismaModel>
    _max?: NestedEnumOrgRoleFilter<$PrismaModel>
  }

  export type NestedEnumProjectRoleFilter<$PrismaModel = never> = {
    equals?: $Enums.ProjectRole | EnumProjectRoleFieldRefInput<$PrismaModel>
    in?: $Enums.ProjectRole[] | ListEnumProjectRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.ProjectRole[] | ListEnumProjectRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumProjectRoleFilter<$PrismaModel> | $Enums.ProjectRole
  }

  export type NestedEnumProjectRoleWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.ProjectRole | EnumProjectRoleFieldRefInput<$PrismaModel>
    in?: $Enums.ProjectRole[] | ListEnumProjectRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.ProjectRole[] | ListEnumProjectRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumProjectRoleWithAggregatesFilter<$PrismaModel> | $Enums.ProjectRole
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumProjectRoleFilter<$PrismaModel>
    _max?: NestedEnumProjectRoleFilter<$PrismaModel>
  }

  export type OnboardingProgressCreateWithoutUserInput = {
    currentStep?: number
    selections?: JsonNullValueInput | InputJsonValue
    completedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type OnboardingProgressUncheckedCreateWithoutUserInput = {
    currentStep?: number
    selections?: JsonNullValueInput | InputJsonValue
    completedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type OnboardingProgressCreateOrConnectWithoutUserInput = {
    where: OnboardingProgressWhereUniqueInput
    create: XOR<OnboardingProgressCreateWithoutUserInput, OnboardingProgressUncheckedCreateWithoutUserInput>
  }

  export type OrganizationMemberCreateWithoutUserInput = {
    id?: string
    role?: $Enums.OrgRole
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutMembersInput
  }

  export type OrganizationMemberUncheckedCreateWithoutUserInput = {
    id?: string
    organizationId: string
    role?: $Enums.OrgRole
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type OrganizationMemberCreateOrConnectWithoutUserInput = {
    where: OrganizationMemberWhereUniqueInput
    create: XOR<OrganizationMemberCreateWithoutUserInput, OrganizationMemberUncheckedCreateWithoutUserInput>
  }

  export type OrganizationMemberCreateManyUserInputEnvelope = {
    data: OrganizationMemberCreateManyUserInput | OrganizationMemberCreateManyUserInput[]
    skipDuplicates?: boolean
  }

  export type TeamMemberCreateWithoutUserInput = {
    id?: string
    createdAt?: Date | string
    updatedAt?: Date | string
    team: TeamCreateNestedOneWithoutMembersInput
  }

  export type TeamMemberUncheckedCreateWithoutUserInput = {
    id?: string
    teamId: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TeamMemberCreateOrConnectWithoutUserInput = {
    where: TeamMemberWhereUniqueInput
    create: XOR<TeamMemberCreateWithoutUserInput, TeamMemberUncheckedCreateWithoutUserInput>
  }

  export type TeamMemberCreateManyUserInputEnvelope = {
    data: TeamMemberCreateManyUserInput | TeamMemberCreateManyUserInput[]
    skipDuplicates?: boolean
  }

  export type ProjectMemberCreateWithoutUserInput = {
    id?: string
    role?: $Enums.ProjectRole
    createdAt?: Date | string
    project: ProjectCreateNestedOneWithoutMembersInput
  }

  export type ProjectMemberUncheckedCreateWithoutUserInput = {
    id?: string
    projectId: string
    role?: $Enums.ProjectRole
    createdAt?: Date | string
  }

  export type ProjectMemberCreateOrConnectWithoutUserInput = {
    where: ProjectMemberWhereUniqueInput
    create: XOR<ProjectMemberCreateWithoutUserInput, ProjectMemberUncheckedCreateWithoutUserInput>
  }

  export type ProjectMemberCreateManyUserInputEnvelope = {
    data: ProjectMemberCreateManyUserInput | ProjectMemberCreateManyUserInput[]
    skipDuplicates?: boolean
  }

  export type MarketplaceAssetCreateWithoutAuthorInput = {
    id?: string
    title: string
    description?: string | null
    tags?: MarketplaceAssetCreatetagsInput | string[]
    thumbnailUrl?: string | null
    isPublished?: boolean
    cloneCount?: number
    createdAt?: Date | string
    updatedAt?: Date | string
    project: ProjectCreateNestedOneWithoutPublishedAssetInput
    clones?: ProjectCloneCreateNestedManyWithoutAssetInput
  }

  export type MarketplaceAssetUncheckedCreateWithoutAuthorInput = {
    id?: string
    projectId: string
    title: string
    description?: string | null
    tags?: MarketplaceAssetCreatetagsInput | string[]
    thumbnailUrl?: string | null
    isPublished?: boolean
    cloneCount?: number
    createdAt?: Date | string
    updatedAt?: Date | string
    clones?: ProjectCloneUncheckedCreateNestedManyWithoutAssetInput
  }

  export type MarketplaceAssetCreateOrConnectWithoutAuthorInput = {
    where: MarketplaceAssetWhereUniqueInput
    create: XOR<MarketplaceAssetCreateWithoutAuthorInput, MarketplaceAssetUncheckedCreateWithoutAuthorInput>
  }

  export type MarketplaceAssetCreateManyAuthorInputEnvelope = {
    data: MarketplaceAssetCreateManyAuthorInput | MarketplaceAssetCreateManyAuthorInput[]
    skipDuplicates?: boolean
  }

  export type ProjectCloneCreateWithoutClonedByInput = {
    id?: string
    createdAt?: Date | string
    asset: MarketplaceAssetCreateNestedOneWithoutClonesInput
    clonedProject: ProjectCreateNestedOneWithoutClonedFromInput
  }

  export type ProjectCloneUncheckedCreateWithoutClonedByInput = {
    id?: string
    sourceAssetId: string
    clonedProjectId: string
    createdAt?: Date | string
  }

  export type ProjectCloneCreateOrConnectWithoutClonedByInput = {
    where: ProjectCloneWhereUniqueInput
    create: XOR<ProjectCloneCreateWithoutClonedByInput, ProjectCloneUncheckedCreateWithoutClonedByInput>
  }

  export type ProjectCloneCreateManyClonedByInputEnvelope = {
    data: ProjectCloneCreateManyClonedByInput | ProjectCloneCreateManyClonedByInput[]
    skipDuplicates?: boolean
  }

  export type OnboardingProgressUpsertWithoutUserInput = {
    update: XOR<OnboardingProgressUpdateWithoutUserInput, OnboardingProgressUncheckedUpdateWithoutUserInput>
    create: XOR<OnboardingProgressCreateWithoutUserInput, OnboardingProgressUncheckedCreateWithoutUserInput>
    where?: OnboardingProgressWhereInput
  }

  export type OnboardingProgressUpdateToOneWithWhereWithoutUserInput = {
    where?: OnboardingProgressWhereInput
    data: XOR<OnboardingProgressUpdateWithoutUserInput, OnboardingProgressUncheckedUpdateWithoutUserInput>
  }

  export type OnboardingProgressUpdateWithoutUserInput = {
    currentStep?: IntFieldUpdateOperationsInput | number
    selections?: JsonNullValueInput | InputJsonValue
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OnboardingProgressUncheckedUpdateWithoutUserInput = {
    currentStep?: IntFieldUpdateOperationsInput | number
    selections?: JsonNullValueInput | InputJsonValue
    completedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationMemberUpsertWithWhereUniqueWithoutUserInput = {
    where: OrganizationMemberWhereUniqueInput
    update: XOR<OrganizationMemberUpdateWithoutUserInput, OrganizationMemberUncheckedUpdateWithoutUserInput>
    create: XOR<OrganizationMemberCreateWithoutUserInput, OrganizationMemberUncheckedCreateWithoutUserInput>
  }

  export type OrganizationMemberUpdateWithWhereUniqueWithoutUserInput = {
    where: OrganizationMemberWhereUniqueInput
    data: XOR<OrganizationMemberUpdateWithoutUserInput, OrganizationMemberUncheckedUpdateWithoutUserInput>
  }

  export type OrganizationMemberUpdateManyWithWhereWithoutUserInput = {
    where: OrganizationMemberScalarWhereInput
    data: XOR<OrganizationMemberUpdateManyMutationInput, OrganizationMemberUncheckedUpdateManyWithoutUserInput>
  }

  export type OrganizationMemberScalarWhereInput = {
    AND?: OrganizationMemberScalarWhereInput | OrganizationMemberScalarWhereInput[]
    OR?: OrganizationMemberScalarWhereInput[]
    NOT?: OrganizationMemberScalarWhereInput | OrganizationMemberScalarWhereInput[]
    id?: StringFilter<"OrganizationMember"> | string
    organizationId?: StringFilter<"OrganizationMember"> | string
    userId?: StringFilter<"OrganizationMember"> | string
    role?: EnumOrgRoleFilter<"OrganizationMember"> | $Enums.OrgRole
    createdAt?: DateTimeFilter<"OrganizationMember"> | Date | string
    updatedAt?: DateTimeFilter<"OrganizationMember"> | Date | string
  }

  export type TeamMemberUpsertWithWhereUniqueWithoutUserInput = {
    where: TeamMemberWhereUniqueInput
    update: XOR<TeamMemberUpdateWithoutUserInput, TeamMemberUncheckedUpdateWithoutUserInput>
    create: XOR<TeamMemberCreateWithoutUserInput, TeamMemberUncheckedCreateWithoutUserInput>
  }

  export type TeamMemberUpdateWithWhereUniqueWithoutUserInput = {
    where: TeamMemberWhereUniqueInput
    data: XOR<TeamMemberUpdateWithoutUserInput, TeamMemberUncheckedUpdateWithoutUserInput>
  }

  export type TeamMemberUpdateManyWithWhereWithoutUserInput = {
    where: TeamMemberScalarWhereInput
    data: XOR<TeamMemberUpdateManyMutationInput, TeamMemberUncheckedUpdateManyWithoutUserInput>
  }

  export type TeamMemberScalarWhereInput = {
    AND?: TeamMemberScalarWhereInput | TeamMemberScalarWhereInput[]
    OR?: TeamMemberScalarWhereInput[]
    NOT?: TeamMemberScalarWhereInput | TeamMemberScalarWhereInput[]
    id?: StringFilter<"TeamMember"> | string
    teamId?: StringFilter<"TeamMember"> | string
    userId?: StringFilter<"TeamMember"> | string
    createdAt?: DateTimeFilter<"TeamMember"> | Date | string
    updatedAt?: DateTimeFilter<"TeamMember"> | Date | string
  }

  export type ProjectMemberUpsertWithWhereUniqueWithoutUserInput = {
    where: ProjectMemberWhereUniqueInput
    update: XOR<ProjectMemberUpdateWithoutUserInput, ProjectMemberUncheckedUpdateWithoutUserInput>
    create: XOR<ProjectMemberCreateWithoutUserInput, ProjectMemberUncheckedCreateWithoutUserInput>
  }

  export type ProjectMemberUpdateWithWhereUniqueWithoutUserInput = {
    where: ProjectMemberWhereUniqueInput
    data: XOR<ProjectMemberUpdateWithoutUserInput, ProjectMemberUncheckedUpdateWithoutUserInput>
  }

  export type ProjectMemberUpdateManyWithWhereWithoutUserInput = {
    where: ProjectMemberScalarWhereInput
    data: XOR<ProjectMemberUpdateManyMutationInput, ProjectMemberUncheckedUpdateManyWithoutUserInput>
  }

  export type ProjectMemberScalarWhereInput = {
    AND?: ProjectMemberScalarWhereInput | ProjectMemberScalarWhereInput[]
    OR?: ProjectMemberScalarWhereInput[]
    NOT?: ProjectMemberScalarWhereInput | ProjectMemberScalarWhereInput[]
    id?: StringFilter<"ProjectMember"> | string
    projectId?: StringFilter<"ProjectMember"> | string
    userId?: StringFilter<"ProjectMember"> | string
    role?: EnumProjectRoleFilter<"ProjectMember"> | $Enums.ProjectRole
    createdAt?: DateTimeFilter<"ProjectMember"> | Date | string
  }

  export type MarketplaceAssetUpsertWithWhereUniqueWithoutAuthorInput = {
    where: MarketplaceAssetWhereUniqueInput
    update: XOR<MarketplaceAssetUpdateWithoutAuthorInput, MarketplaceAssetUncheckedUpdateWithoutAuthorInput>
    create: XOR<MarketplaceAssetCreateWithoutAuthorInput, MarketplaceAssetUncheckedCreateWithoutAuthorInput>
  }

  export type MarketplaceAssetUpdateWithWhereUniqueWithoutAuthorInput = {
    where: MarketplaceAssetWhereUniqueInput
    data: XOR<MarketplaceAssetUpdateWithoutAuthorInput, MarketplaceAssetUncheckedUpdateWithoutAuthorInput>
  }

  export type MarketplaceAssetUpdateManyWithWhereWithoutAuthorInput = {
    where: MarketplaceAssetScalarWhereInput
    data: XOR<MarketplaceAssetUpdateManyMutationInput, MarketplaceAssetUncheckedUpdateManyWithoutAuthorInput>
  }

  export type MarketplaceAssetScalarWhereInput = {
    AND?: MarketplaceAssetScalarWhereInput | MarketplaceAssetScalarWhereInput[]
    OR?: MarketplaceAssetScalarWhereInput[]
    NOT?: MarketplaceAssetScalarWhereInput | MarketplaceAssetScalarWhereInput[]
    id?: StringFilter<"MarketplaceAsset"> | string
    projectId?: StringFilter<"MarketplaceAsset"> | string
    authorId?: StringFilter<"MarketplaceAsset"> | string
    title?: StringFilter<"MarketplaceAsset"> | string
    description?: StringNullableFilter<"MarketplaceAsset"> | string | null
    tags?: StringNullableListFilter<"MarketplaceAsset">
    thumbnailUrl?: StringNullableFilter<"MarketplaceAsset"> | string | null
    isPublished?: BoolFilter<"MarketplaceAsset"> | boolean
    cloneCount?: IntFilter<"MarketplaceAsset"> | number
    createdAt?: DateTimeFilter<"MarketplaceAsset"> | Date | string
    updatedAt?: DateTimeFilter<"MarketplaceAsset"> | Date | string
  }

  export type ProjectCloneUpsertWithWhereUniqueWithoutClonedByInput = {
    where: ProjectCloneWhereUniqueInput
    update: XOR<ProjectCloneUpdateWithoutClonedByInput, ProjectCloneUncheckedUpdateWithoutClonedByInput>
    create: XOR<ProjectCloneCreateWithoutClonedByInput, ProjectCloneUncheckedCreateWithoutClonedByInput>
  }

  export type ProjectCloneUpdateWithWhereUniqueWithoutClonedByInput = {
    where: ProjectCloneWhereUniqueInput
    data: XOR<ProjectCloneUpdateWithoutClonedByInput, ProjectCloneUncheckedUpdateWithoutClonedByInput>
  }

  export type ProjectCloneUpdateManyWithWhereWithoutClonedByInput = {
    where: ProjectCloneScalarWhereInput
    data: XOR<ProjectCloneUpdateManyMutationInput, ProjectCloneUncheckedUpdateManyWithoutClonedByInput>
  }

  export type ProjectCloneScalarWhereInput = {
    AND?: ProjectCloneScalarWhereInput | ProjectCloneScalarWhereInput[]
    OR?: ProjectCloneScalarWhereInput[]
    NOT?: ProjectCloneScalarWhereInput | ProjectCloneScalarWhereInput[]
    id?: StringFilter<"ProjectClone"> | string
    sourceAssetId?: StringFilter<"ProjectClone"> | string
    clonedProjectId?: StringFilter<"ProjectClone"> | string
    clonedByUserId?: StringFilter<"ProjectClone"> | string
    createdAt?: DateTimeFilter<"ProjectClone"> | Date | string
  }

  export type UserCreateWithoutOnboardingProgressInput = {
    id?: string
    name?: string | null
    email?: string | null
    emailVerified?: Date | string | null
    image?: string | null
    password?: string | null
    bio?: string | null
    onboardingComplete?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    organizations?: OrganizationMemberCreateNestedManyWithoutUserInput
    teamMemberships?: TeamMemberCreateNestedManyWithoutUserInput
    projectMemberships?: ProjectMemberCreateNestedManyWithoutUserInput
    publishedAssets?: MarketplaceAssetCreateNestedManyWithoutAuthorInput
    clonedProjects?: ProjectCloneCreateNestedManyWithoutClonedByInput
  }

  export type UserUncheckedCreateWithoutOnboardingProgressInput = {
    id?: string
    name?: string | null
    email?: string | null
    emailVerified?: Date | string | null
    image?: string | null
    password?: string | null
    bio?: string | null
    onboardingComplete?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    organizations?: OrganizationMemberUncheckedCreateNestedManyWithoutUserInput
    teamMemberships?: TeamMemberUncheckedCreateNestedManyWithoutUserInput
    projectMemberships?: ProjectMemberUncheckedCreateNestedManyWithoutUserInput
    publishedAssets?: MarketplaceAssetUncheckedCreateNestedManyWithoutAuthorInput
    clonedProjects?: ProjectCloneUncheckedCreateNestedManyWithoutClonedByInput
  }

  export type UserCreateOrConnectWithoutOnboardingProgressInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutOnboardingProgressInput, UserUncheckedCreateWithoutOnboardingProgressInput>
  }

  export type UserUpsertWithoutOnboardingProgressInput = {
    update: XOR<UserUpdateWithoutOnboardingProgressInput, UserUncheckedUpdateWithoutOnboardingProgressInput>
    create: XOR<UserCreateWithoutOnboardingProgressInput, UserUncheckedCreateWithoutOnboardingProgressInput>
    where?: UserWhereInput
  }

  export type UserUpdateToOneWithWhereWithoutOnboardingProgressInput = {
    where?: UserWhereInput
    data: XOR<UserUpdateWithoutOnboardingProgressInput, UserUncheckedUpdateWithoutOnboardingProgressInput>
  }

  export type UserUpdateWithoutOnboardingProgressInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organizations?: OrganizationMemberUpdateManyWithoutUserNestedInput
    teamMemberships?: TeamMemberUpdateManyWithoutUserNestedInput
    projectMemberships?: ProjectMemberUpdateManyWithoutUserNestedInput
    publishedAssets?: MarketplaceAssetUpdateManyWithoutAuthorNestedInput
    clonedProjects?: ProjectCloneUpdateManyWithoutClonedByNestedInput
  }

  export type UserUncheckedUpdateWithoutOnboardingProgressInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organizations?: OrganizationMemberUncheckedUpdateManyWithoutUserNestedInput
    teamMemberships?: TeamMemberUncheckedUpdateManyWithoutUserNestedInput
    projectMemberships?: ProjectMemberUncheckedUpdateManyWithoutUserNestedInput
    publishedAssets?: MarketplaceAssetUncheckedUpdateManyWithoutAuthorNestedInput
    clonedProjects?: ProjectCloneUncheckedUpdateManyWithoutClonedByNestedInput
  }

  export type OrganizationMemberCreateWithoutOrganizationInput = {
    id?: string
    role?: $Enums.OrgRole
    createdAt?: Date | string
    updatedAt?: Date | string
    user: UserCreateNestedOneWithoutOrganizationsInput
  }

  export type OrganizationMemberUncheckedCreateWithoutOrganizationInput = {
    id?: string
    userId: string
    role?: $Enums.OrgRole
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type OrganizationMemberCreateOrConnectWithoutOrganizationInput = {
    where: OrganizationMemberWhereUniqueInput
    create: XOR<OrganizationMemberCreateWithoutOrganizationInput, OrganizationMemberUncheckedCreateWithoutOrganizationInput>
  }

  export type OrganizationMemberCreateManyOrganizationInputEnvelope = {
    data: OrganizationMemberCreateManyOrganizationInput | OrganizationMemberCreateManyOrganizationInput[]
    skipDuplicates?: boolean
  }

  export type TeamCreateWithoutOrganizationInput = {
    id?: string
    name: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    members?: TeamMemberCreateNestedManyWithoutTeamInput
    projects?: ProjectCreateNestedManyWithoutTeamInput
  }

  export type TeamUncheckedCreateWithoutOrganizationInput = {
    id?: string
    name: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    members?: TeamMemberUncheckedCreateNestedManyWithoutTeamInput
    projects?: ProjectUncheckedCreateNestedManyWithoutTeamInput
  }

  export type TeamCreateOrConnectWithoutOrganizationInput = {
    where: TeamWhereUniqueInput
    create: XOR<TeamCreateWithoutOrganizationInput, TeamUncheckedCreateWithoutOrganizationInput>
  }

  export type TeamCreateManyOrganizationInputEnvelope = {
    data: TeamCreateManyOrganizationInput | TeamCreateManyOrganizationInput[]
    skipDuplicates?: boolean
  }

  export type OrganizationInviteTokenCreateWithoutOrganizationInput = {
    id?: string
    token?: string
    createdByUserId: string
    expiresAt: Date | string
    usedAt?: Date | string | null
    usedByUserId?: string | null
    createdAt?: Date | string
  }

  export type OrganizationInviteTokenUncheckedCreateWithoutOrganizationInput = {
    id?: string
    token?: string
    createdByUserId: string
    expiresAt: Date | string
    usedAt?: Date | string | null
    usedByUserId?: string | null
    createdAt?: Date | string
  }

  export type OrganizationInviteTokenCreateOrConnectWithoutOrganizationInput = {
    where: OrganizationInviteTokenWhereUniqueInput
    create: XOR<OrganizationInviteTokenCreateWithoutOrganizationInput, OrganizationInviteTokenUncheckedCreateWithoutOrganizationInput>
  }

  export type OrganizationInviteTokenCreateManyOrganizationInputEnvelope = {
    data: OrganizationInviteTokenCreateManyOrganizationInput | OrganizationInviteTokenCreateManyOrganizationInput[]
    skipDuplicates?: boolean
  }

  export type OrganizationMemberUpsertWithWhereUniqueWithoutOrganizationInput = {
    where: OrganizationMemberWhereUniqueInput
    update: XOR<OrganizationMemberUpdateWithoutOrganizationInput, OrganizationMemberUncheckedUpdateWithoutOrganizationInput>
    create: XOR<OrganizationMemberCreateWithoutOrganizationInput, OrganizationMemberUncheckedCreateWithoutOrganizationInput>
  }

  export type OrganizationMemberUpdateWithWhereUniqueWithoutOrganizationInput = {
    where: OrganizationMemberWhereUniqueInput
    data: XOR<OrganizationMemberUpdateWithoutOrganizationInput, OrganizationMemberUncheckedUpdateWithoutOrganizationInput>
  }

  export type OrganizationMemberUpdateManyWithWhereWithoutOrganizationInput = {
    where: OrganizationMemberScalarWhereInput
    data: XOR<OrganizationMemberUpdateManyMutationInput, OrganizationMemberUncheckedUpdateManyWithoutOrganizationInput>
  }

  export type TeamUpsertWithWhereUniqueWithoutOrganizationInput = {
    where: TeamWhereUniqueInput
    update: XOR<TeamUpdateWithoutOrganizationInput, TeamUncheckedUpdateWithoutOrganizationInput>
    create: XOR<TeamCreateWithoutOrganizationInput, TeamUncheckedCreateWithoutOrganizationInput>
  }

  export type TeamUpdateWithWhereUniqueWithoutOrganizationInput = {
    where: TeamWhereUniqueInput
    data: XOR<TeamUpdateWithoutOrganizationInput, TeamUncheckedUpdateWithoutOrganizationInput>
  }

  export type TeamUpdateManyWithWhereWithoutOrganizationInput = {
    where: TeamScalarWhereInput
    data: XOR<TeamUpdateManyMutationInput, TeamUncheckedUpdateManyWithoutOrganizationInput>
  }

  export type TeamScalarWhereInput = {
    AND?: TeamScalarWhereInput | TeamScalarWhereInput[]
    OR?: TeamScalarWhereInput[]
    NOT?: TeamScalarWhereInput | TeamScalarWhereInput[]
    id?: StringFilter<"Team"> | string
    organizationId?: StringFilter<"Team"> | string
    name?: StringFilter<"Team"> | string
    description?: StringNullableFilter<"Team"> | string | null
    createdAt?: DateTimeFilter<"Team"> | Date | string
    updatedAt?: DateTimeFilter<"Team"> | Date | string
  }

  export type OrganizationInviteTokenUpsertWithWhereUniqueWithoutOrganizationInput = {
    where: OrganizationInviteTokenWhereUniqueInput
    update: XOR<OrganizationInviteTokenUpdateWithoutOrganizationInput, OrganizationInviteTokenUncheckedUpdateWithoutOrganizationInput>
    create: XOR<OrganizationInviteTokenCreateWithoutOrganizationInput, OrganizationInviteTokenUncheckedCreateWithoutOrganizationInput>
  }

  export type OrganizationInviteTokenUpdateWithWhereUniqueWithoutOrganizationInput = {
    where: OrganizationInviteTokenWhereUniqueInput
    data: XOR<OrganizationInviteTokenUpdateWithoutOrganizationInput, OrganizationInviteTokenUncheckedUpdateWithoutOrganizationInput>
  }

  export type OrganizationInviteTokenUpdateManyWithWhereWithoutOrganizationInput = {
    where: OrganizationInviteTokenScalarWhereInput
    data: XOR<OrganizationInviteTokenUpdateManyMutationInput, OrganizationInviteTokenUncheckedUpdateManyWithoutOrganizationInput>
  }

  export type OrganizationInviteTokenScalarWhereInput = {
    AND?: OrganizationInviteTokenScalarWhereInput | OrganizationInviteTokenScalarWhereInput[]
    OR?: OrganizationInviteTokenScalarWhereInput[]
    NOT?: OrganizationInviteTokenScalarWhereInput | OrganizationInviteTokenScalarWhereInput[]
    id?: StringFilter<"OrganizationInviteToken"> | string
    organizationId?: StringFilter<"OrganizationInviteToken"> | string
    token?: StringFilter<"OrganizationInviteToken"> | string
    createdByUserId?: StringFilter<"OrganizationInviteToken"> | string
    expiresAt?: DateTimeFilter<"OrganizationInviteToken"> | Date | string
    usedAt?: DateTimeNullableFilter<"OrganizationInviteToken"> | Date | string | null
    usedByUserId?: StringNullableFilter<"OrganizationInviteToken"> | string | null
    createdAt?: DateTimeFilter<"OrganizationInviteToken"> | Date | string
  }

  export type OrganizationCreateWithoutMembersInput = {
    id?: string
    name: string
    slug: string
    domain?: string | null
    logoUrl?: string | null
    status?: $Enums.OrgStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    teams?: TeamCreateNestedManyWithoutOrganizationInput
    inviteTokens?: OrganizationInviteTokenCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationUncheckedCreateWithoutMembersInput = {
    id?: string
    name: string
    slug: string
    domain?: string | null
    logoUrl?: string | null
    status?: $Enums.OrgStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    teams?: TeamUncheckedCreateNestedManyWithoutOrganizationInput
    inviteTokens?: OrganizationInviteTokenUncheckedCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationCreateOrConnectWithoutMembersInput = {
    where: OrganizationWhereUniqueInput
    create: XOR<OrganizationCreateWithoutMembersInput, OrganizationUncheckedCreateWithoutMembersInput>
  }

  export type UserCreateWithoutOrganizationsInput = {
    id?: string
    name?: string | null
    email?: string | null
    emailVerified?: Date | string | null
    image?: string | null
    password?: string | null
    bio?: string | null
    onboardingComplete?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    onboardingProgress?: OnboardingProgressCreateNestedOneWithoutUserInput
    teamMemberships?: TeamMemberCreateNestedManyWithoutUserInput
    projectMemberships?: ProjectMemberCreateNestedManyWithoutUserInput
    publishedAssets?: MarketplaceAssetCreateNestedManyWithoutAuthorInput
    clonedProjects?: ProjectCloneCreateNestedManyWithoutClonedByInput
  }

  export type UserUncheckedCreateWithoutOrganizationsInput = {
    id?: string
    name?: string | null
    email?: string | null
    emailVerified?: Date | string | null
    image?: string | null
    password?: string | null
    bio?: string | null
    onboardingComplete?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    onboardingProgress?: OnboardingProgressUncheckedCreateNestedOneWithoutUserInput
    teamMemberships?: TeamMemberUncheckedCreateNestedManyWithoutUserInput
    projectMemberships?: ProjectMemberUncheckedCreateNestedManyWithoutUserInput
    publishedAssets?: MarketplaceAssetUncheckedCreateNestedManyWithoutAuthorInput
    clonedProjects?: ProjectCloneUncheckedCreateNestedManyWithoutClonedByInput
  }

  export type UserCreateOrConnectWithoutOrganizationsInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutOrganizationsInput, UserUncheckedCreateWithoutOrganizationsInput>
  }

  export type OrganizationUpsertWithoutMembersInput = {
    update: XOR<OrganizationUpdateWithoutMembersInput, OrganizationUncheckedUpdateWithoutMembersInput>
    create: XOR<OrganizationCreateWithoutMembersInput, OrganizationUncheckedCreateWithoutMembersInput>
    where?: OrganizationWhereInput
  }

  export type OrganizationUpdateToOneWithWhereWithoutMembersInput = {
    where?: OrganizationWhereInput
    data: XOR<OrganizationUpdateWithoutMembersInput, OrganizationUncheckedUpdateWithoutMembersInput>
  }

  export type OrganizationUpdateWithoutMembersInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    domain?: NullableStringFieldUpdateOperationsInput | string | null
    logoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumOrgStatusFieldUpdateOperationsInput | $Enums.OrgStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    teams?: TeamUpdateManyWithoutOrganizationNestedInput
    inviteTokens?: OrganizationInviteTokenUpdateManyWithoutOrganizationNestedInput
  }

  export type OrganizationUncheckedUpdateWithoutMembersInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    domain?: NullableStringFieldUpdateOperationsInput | string | null
    logoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumOrgStatusFieldUpdateOperationsInput | $Enums.OrgStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    teams?: TeamUncheckedUpdateManyWithoutOrganizationNestedInput
    inviteTokens?: OrganizationInviteTokenUncheckedUpdateManyWithoutOrganizationNestedInput
  }

  export type UserUpsertWithoutOrganizationsInput = {
    update: XOR<UserUpdateWithoutOrganizationsInput, UserUncheckedUpdateWithoutOrganizationsInput>
    create: XOR<UserCreateWithoutOrganizationsInput, UserUncheckedCreateWithoutOrganizationsInput>
    where?: UserWhereInput
  }

  export type UserUpdateToOneWithWhereWithoutOrganizationsInput = {
    where?: UserWhereInput
    data: XOR<UserUpdateWithoutOrganizationsInput, UserUncheckedUpdateWithoutOrganizationsInput>
  }

  export type UserUpdateWithoutOrganizationsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    onboardingProgress?: OnboardingProgressUpdateOneWithoutUserNestedInput
    teamMemberships?: TeamMemberUpdateManyWithoutUserNestedInput
    projectMemberships?: ProjectMemberUpdateManyWithoutUserNestedInput
    publishedAssets?: MarketplaceAssetUpdateManyWithoutAuthorNestedInput
    clonedProjects?: ProjectCloneUpdateManyWithoutClonedByNestedInput
  }

  export type UserUncheckedUpdateWithoutOrganizationsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    onboardingProgress?: OnboardingProgressUncheckedUpdateOneWithoutUserNestedInput
    teamMemberships?: TeamMemberUncheckedUpdateManyWithoutUserNestedInput
    projectMemberships?: ProjectMemberUncheckedUpdateManyWithoutUserNestedInput
    publishedAssets?: MarketplaceAssetUncheckedUpdateManyWithoutAuthorNestedInput
    clonedProjects?: ProjectCloneUncheckedUpdateManyWithoutClonedByNestedInput
  }

  export type OrganizationCreateWithoutInviteTokensInput = {
    id?: string
    name: string
    slug: string
    domain?: string | null
    logoUrl?: string | null
    status?: $Enums.OrgStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    members?: OrganizationMemberCreateNestedManyWithoutOrganizationInput
    teams?: TeamCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationUncheckedCreateWithoutInviteTokensInput = {
    id?: string
    name: string
    slug: string
    domain?: string | null
    logoUrl?: string | null
    status?: $Enums.OrgStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    members?: OrganizationMemberUncheckedCreateNestedManyWithoutOrganizationInput
    teams?: TeamUncheckedCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationCreateOrConnectWithoutInviteTokensInput = {
    where: OrganizationWhereUniqueInput
    create: XOR<OrganizationCreateWithoutInviteTokensInput, OrganizationUncheckedCreateWithoutInviteTokensInput>
  }

  export type OrganizationUpsertWithoutInviteTokensInput = {
    update: XOR<OrganizationUpdateWithoutInviteTokensInput, OrganizationUncheckedUpdateWithoutInviteTokensInput>
    create: XOR<OrganizationCreateWithoutInviteTokensInput, OrganizationUncheckedCreateWithoutInviteTokensInput>
    where?: OrganizationWhereInput
  }

  export type OrganizationUpdateToOneWithWhereWithoutInviteTokensInput = {
    where?: OrganizationWhereInput
    data: XOR<OrganizationUpdateWithoutInviteTokensInput, OrganizationUncheckedUpdateWithoutInviteTokensInput>
  }

  export type OrganizationUpdateWithoutInviteTokensInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    domain?: NullableStringFieldUpdateOperationsInput | string | null
    logoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumOrgStatusFieldUpdateOperationsInput | $Enums.OrgStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: OrganizationMemberUpdateManyWithoutOrganizationNestedInput
    teams?: TeamUpdateManyWithoutOrganizationNestedInput
  }

  export type OrganizationUncheckedUpdateWithoutInviteTokensInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    domain?: NullableStringFieldUpdateOperationsInput | string | null
    logoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumOrgStatusFieldUpdateOperationsInput | $Enums.OrgStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: OrganizationMemberUncheckedUpdateManyWithoutOrganizationNestedInput
    teams?: TeamUncheckedUpdateManyWithoutOrganizationNestedInput
  }

  export type OrganizationCreateWithoutTeamsInput = {
    id?: string
    name: string
    slug: string
    domain?: string | null
    logoUrl?: string | null
    status?: $Enums.OrgStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    members?: OrganizationMemberCreateNestedManyWithoutOrganizationInput
    inviteTokens?: OrganizationInviteTokenCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationUncheckedCreateWithoutTeamsInput = {
    id?: string
    name: string
    slug: string
    domain?: string | null
    logoUrl?: string | null
    status?: $Enums.OrgStatus
    createdAt?: Date | string
    updatedAt?: Date | string
    members?: OrganizationMemberUncheckedCreateNestedManyWithoutOrganizationInput
    inviteTokens?: OrganizationInviteTokenUncheckedCreateNestedManyWithoutOrganizationInput
  }

  export type OrganizationCreateOrConnectWithoutTeamsInput = {
    where: OrganizationWhereUniqueInput
    create: XOR<OrganizationCreateWithoutTeamsInput, OrganizationUncheckedCreateWithoutTeamsInput>
  }

  export type TeamMemberCreateWithoutTeamInput = {
    id?: string
    createdAt?: Date | string
    updatedAt?: Date | string
    user: UserCreateNestedOneWithoutTeamMembershipsInput
  }

  export type TeamMemberUncheckedCreateWithoutTeamInput = {
    id?: string
    userId: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TeamMemberCreateOrConnectWithoutTeamInput = {
    where: TeamMemberWhereUniqueInput
    create: XOR<TeamMemberCreateWithoutTeamInput, TeamMemberUncheckedCreateWithoutTeamInput>
  }

  export type TeamMemberCreateManyTeamInputEnvelope = {
    data: TeamMemberCreateManyTeamInput | TeamMemberCreateManyTeamInput[]
    skipDuplicates?: boolean
  }

  export type ProjectCreateWithoutTeamInput = {
    id?: string
    name: string
    description?: string | null
    thumbnailUrl?: string | null
    stateUrl?: string | null
    isPublic?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    members?: ProjectMemberCreateNestedManyWithoutProjectInput
    publishedAsset?: MarketplaceAssetCreateNestedOneWithoutProjectInput
    clonedFrom?: ProjectCloneCreateNestedOneWithoutClonedProjectInput
  }

  export type ProjectUncheckedCreateWithoutTeamInput = {
    id?: string
    name: string
    description?: string | null
    thumbnailUrl?: string | null
    stateUrl?: string | null
    isPublic?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    members?: ProjectMemberUncheckedCreateNestedManyWithoutProjectInput
    publishedAsset?: MarketplaceAssetUncheckedCreateNestedOneWithoutProjectInput
    clonedFrom?: ProjectCloneUncheckedCreateNestedOneWithoutClonedProjectInput
  }

  export type ProjectCreateOrConnectWithoutTeamInput = {
    where: ProjectWhereUniqueInput
    create: XOR<ProjectCreateWithoutTeamInput, ProjectUncheckedCreateWithoutTeamInput>
  }

  export type ProjectCreateManyTeamInputEnvelope = {
    data: ProjectCreateManyTeamInput | ProjectCreateManyTeamInput[]
    skipDuplicates?: boolean
  }

  export type OrganizationUpsertWithoutTeamsInput = {
    update: XOR<OrganizationUpdateWithoutTeamsInput, OrganizationUncheckedUpdateWithoutTeamsInput>
    create: XOR<OrganizationCreateWithoutTeamsInput, OrganizationUncheckedCreateWithoutTeamsInput>
    where?: OrganizationWhereInput
  }

  export type OrganizationUpdateToOneWithWhereWithoutTeamsInput = {
    where?: OrganizationWhereInput
    data: XOR<OrganizationUpdateWithoutTeamsInput, OrganizationUncheckedUpdateWithoutTeamsInput>
  }

  export type OrganizationUpdateWithoutTeamsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    domain?: NullableStringFieldUpdateOperationsInput | string | null
    logoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumOrgStatusFieldUpdateOperationsInput | $Enums.OrgStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: OrganizationMemberUpdateManyWithoutOrganizationNestedInput
    inviteTokens?: OrganizationInviteTokenUpdateManyWithoutOrganizationNestedInput
  }

  export type OrganizationUncheckedUpdateWithoutTeamsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    slug?: StringFieldUpdateOperationsInput | string
    domain?: NullableStringFieldUpdateOperationsInput | string | null
    logoUrl?: NullableStringFieldUpdateOperationsInput | string | null
    status?: EnumOrgStatusFieldUpdateOperationsInput | $Enums.OrgStatus
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: OrganizationMemberUncheckedUpdateManyWithoutOrganizationNestedInput
    inviteTokens?: OrganizationInviteTokenUncheckedUpdateManyWithoutOrganizationNestedInput
  }

  export type TeamMemberUpsertWithWhereUniqueWithoutTeamInput = {
    where: TeamMemberWhereUniqueInput
    update: XOR<TeamMemberUpdateWithoutTeamInput, TeamMemberUncheckedUpdateWithoutTeamInput>
    create: XOR<TeamMemberCreateWithoutTeamInput, TeamMemberUncheckedCreateWithoutTeamInput>
  }

  export type TeamMemberUpdateWithWhereUniqueWithoutTeamInput = {
    where: TeamMemberWhereUniqueInput
    data: XOR<TeamMemberUpdateWithoutTeamInput, TeamMemberUncheckedUpdateWithoutTeamInput>
  }

  export type TeamMemberUpdateManyWithWhereWithoutTeamInput = {
    where: TeamMemberScalarWhereInput
    data: XOR<TeamMemberUpdateManyMutationInput, TeamMemberUncheckedUpdateManyWithoutTeamInput>
  }

  export type ProjectUpsertWithWhereUniqueWithoutTeamInput = {
    where: ProjectWhereUniqueInput
    update: XOR<ProjectUpdateWithoutTeamInput, ProjectUncheckedUpdateWithoutTeamInput>
    create: XOR<ProjectCreateWithoutTeamInput, ProjectUncheckedCreateWithoutTeamInput>
  }

  export type ProjectUpdateWithWhereUniqueWithoutTeamInput = {
    where: ProjectWhereUniqueInput
    data: XOR<ProjectUpdateWithoutTeamInput, ProjectUncheckedUpdateWithoutTeamInput>
  }

  export type ProjectUpdateManyWithWhereWithoutTeamInput = {
    where: ProjectScalarWhereInput
    data: XOR<ProjectUpdateManyMutationInput, ProjectUncheckedUpdateManyWithoutTeamInput>
  }

  export type ProjectScalarWhereInput = {
    AND?: ProjectScalarWhereInput | ProjectScalarWhereInput[]
    OR?: ProjectScalarWhereInput[]
    NOT?: ProjectScalarWhereInput | ProjectScalarWhereInput[]
    id?: StringFilter<"Project"> | string
    teamId?: StringFilter<"Project"> | string
    name?: StringFilter<"Project"> | string
    description?: StringNullableFilter<"Project"> | string | null
    thumbnailUrl?: StringNullableFilter<"Project"> | string | null
    stateUrl?: StringNullableFilter<"Project"> | string | null
    isPublic?: BoolFilter<"Project"> | boolean
    createdAt?: DateTimeFilter<"Project"> | Date | string
    updatedAt?: DateTimeFilter<"Project"> | Date | string
  }

  export type TeamCreateWithoutMembersInput = {
    id?: string
    name: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutTeamsInput
    projects?: ProjectCreateNestedManyWithoutTeamInput
  }

  export type TeamUncheckedCreateWithoutMembersInput = {
    id?: string
    organizationId: string
    name: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    projects?: ProjectUncheckedCreateNestedManyWithoutTeamInput
  }

  export type TeamCreateOrConnectWithoutMembersInput = {
    where: TeamWhereUniqueInput
    create: XOR<TeamCreateWithoutMembersInput, TeamUncheckedCreateWithoutMembersInput>
  }

  export type UserCreateWithoutTeamMembershipsInput = {
    id?: string
    name?: string | null
    email?: string | null
    emailVerified?: Date | string | null
    image?: string | null
    password?: string | null
    bio?: string | null
    onboardingComplete?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    onboardingProgress?: OnboardingProgressCreateNestedOneWithoutUserInput
    organizations?: OrganizationMemberCreateNestedManyWithoutUserInput
    projectMemberships?: ProjectMemberCreateNestedManyWithoutUserInput
    publishedAssets?: MarketplaceAssetCreateNestedManyWithoutAuthorInput
    clonedProjects?: ProjectCloneCreateNestedManyWithoutClonedByInput
  }

  export type UserUncheckedCreateWithoutTeamMembershipsInput = {
    id?: string
    name?: string | null
    email?: string | null
    emailVerified?: Date | string | null
    image?: string | null
    password?: string | null
    bio?: string | null
    onboardingComplete?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    onboardingProgress?: OnboardingProgressUncheckedCreateNestedOneWithoutUserInput
    organizations?: OrganizationMemberUncheckedCreateNestedManyWithoutUserInput
    projectMemberships?: ProjectMemberUncheckedCreateNestedManyWithoutUserInput
    publishedAssets?: MarketplaceAssetUncheckedCreateNestedManyWithoutAuthorInput
    clonedProjects?: ProjectCloneUncheckedCreateNestedManyWithoutClonedByInput
  }

  export type UserCreateOrConnectWithoutTeamMembershipsInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutTeamMembershipsInput, UserUncheckedCreateWithoutTeamMembershipsInput>
  }

  export type TeamUpsertWithoutMembersInput = {
    update: XOR<TeamUpdateWithoutMembersInput, TeamUncheckedUpdateWithoutMembersInput>
    create: XOR<TeamCreateWithoutMembersInput, TeamUncheckedCreateWithoutMembersInput>
    where?: TeamWhereInput
  }

  export type TeamUpdateToOneWithWhereWithoutMembersInput = {
    where?: TeamWhereInput
    data: XOR<TeamUpdateWithoutMembersInput, TeamUncheckedUpdateWithoutMembersInput>
  }

  export type TeamUpdateWithoutMembersInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutTeamsNestedInput
    projects?: ProjectUpdateManyWithoutTeamNestedInput
  }

  export type TeamUncheckedUpdateWithoutMembersInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    projects?: ProjectUncheckedUpdateManyWithoutTeamNestedInput
  }

  export type UserUpsertWithoutTeamMembershipsInput = {
    update: XOR<UserUpdateWithoutTeamMembershipsInput, UserUncheckedUpdateWithoutTeamMembershipsInput>
    create: XOR<UserCreateWithoutTeamMembershipsInput, UserUncheckedCreateWithoutTeamMembershipsInput>
    where?: UserWhereInput
  }

  export type UserUpdateToOneWithWhereWithoutTeamMembershipsInput = {
    where?: UserWhereInput
    data: XOR<UserUpdateWithoutTeamMembershipsInput, UserUncheckedUpdateWithoutTeamMembershipsInput>
  }

  export type UserUpdateWithoutTeamMembershipsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    onboardingProgress?: OnboardingProgressUpdateOneWithoutUserNestedInput
    organizations?: OrganizationMemberUpdateManyWithoutUserNestedInput
    projectMemberships?: ProjectMemberUpdateManyWithoutUserNestedInput
    publishedAssets?: MarketplaceAssetUpdateManyWithoutAuthorNestedInput
    clonedProjects?: ProjectCloneUpdateManyWithoutClonedByNestedInput
  }

  export type UserUncheckedUpdateWithoutTeamMembershipsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    onboardingProgress?: OnboardingProgressUncheckedUpdateOneWithoutUserNestedInput
    organizations?: OrganizationMemberUncheckedUpdateManyWithoutUserNestedInput
    projectMemberships?: ProjectMemberUncheckedUpdateManyWithoutUserNestedInput
    publishedAssets?: MarketplaceAssetUncheckedUpdateManyWithoutAuthorNestedInput
    clonedProjects?: ProjectCloneUncheckedUpdateManyWithoutClonedByNestedInput
  }

  export type TeamCreateWithoutProjectsInput = {
    id?: string
    name: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    organization: OrganizationCreateNestedOneWithoutTeamsInput
    members?: TeamMemberCreateNestedManyWithoutTeamInput
  }

  export type TeamUncheckedCreateWithoutProjectsInput = {
    id?: string
    organizationId: string
    name: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    members?: TeamMemberUncheckedCreateNestedManyWithoutTeamInput
  }

  export type TeamCreateOrConnectWithoutProjectsInput = {
    where: TeamWhereUniqueInput
    create: XOR<TeamCreateWithoutProjectsInput, TeamUncheckedCreateWithoutProjectsInput>
  }

  export type ProjectMemberCreateWithoutProjectInput = {
    id?: string
    role?: $Enums.ProjectRole
    createdAt?: Date | string
    user: UserCreateNestedOneWithoutProjectMembershipsInput
  }

  export type ProjectMemberUncheckedCreateWithoutProjectInput = {
    id?: string
    userId: string
    role?: $Enums.ProjectRole
    createdAt?: Date | string
  }

  export type ProjectMemberCreateOrConnectWithoutProjectInput = {
    where: ProjectMemberWhereUniqueInput
    create: XOR<ProjectMemberCreateWithoutProjectInput, ProjectMemberUncheckedCreateWithoutProjectInput>
  }

  export type ProjectMemberCreateManyProjectInputEnvelope = {
    data: ProjectMemberCreateManyProjectInput | ProjectMemberCreateManyProjectInput[]
    skipDuplicates?: boolean
  }

  export type MarketplaceAssetCreateWithoutProjectInput = {
    id?: string
    title: string
    description?: string | null
    tags?: MarketplaceAssetCreatetagsInput | string[]
    thumbnailUrl?: string | null
    isPublished?: boolean
    cloneCount?: number
    createdAt?: Date | string
    updatedAt?: Date | string
    author: UserCreateNestedOneWithoutPublishedAssetsInput
    clones?: ProjectCloneCreateNestedManyWithoutAssetInput
  }

  export type MarketplaceAssetUncheckedCreateWithoutProjectInput = {
    id?: string
    authorId: string
    title: string
    description?: string | null
    tags?: MarketplaceAssetCreatetagsInput | string[]
    thumbnailUrl?: string | null
    isPublished?: boolean
    cloneCount?: number
    createdAt?: Date | string
    updatedAt?: Date | string
    clones?: ProjectCloneUncheckedCreateNestedManyWithoutAssetInput
  }

  export type MarketplaceAssetCreateOrConnectWithoutProjectInput = {
    where: MarketplaceAssetWhereUniqueInput
    create: XOR<MarketplaceAssetCreateWithoutProjectInput, MarketplaceAssetUncheckedCreateWithoutProjectInput>
  }

  export type ProjectCloneCreateWithoutClonedProjectInput = {
    id?: string
    createdAt?: Date | string
    asset: MarketplaceAssetCreateNestedOneWithoutClonesInput
    clonedBy: UserCreateNestedOneWithoutClonedProjectsInput
  }

  export type ProjectCloneUncheckedCreateWithoutClonedProjectInput = {
    id?: string
    sourceAssetId: string
    clonedByUserId: string
    createdAt?: Date | string
  }

  export type ProjectCloneCreateOrConnectWithoutClonedProjectInput = {
    where: ProjectCloneWhereUniqueInput
    create: XOR<ProjectCloneCreateWithoutClonedProjectInput, ProjectCloneUncheckedCreateWithoutClonedProjectInput>
  }

  export type TeamUpsertWithoutProjectsInput = {
    update: XOR<TeamUpdateWithoutProjectsInput, TeamUncheckedUpdateWithoutProjectsInput>
    create: XOR<TeamCreateWithoutProjectsInput, TeamUncheckedCreateWithoutProjectsInput>
    where?: TeamWhereInput
  }

  export type TeamUpdateToOneWithWhereWithoutProjectsInput = {
    where?: TeamWhereInput
    data: XOR<TeamUpdateWithoutProjectsInput, TeamUncheckedUpdateWithoutProjectsInput>
  }

  export type TeamUpdateWithoutProjectsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutTeamsNestedInput
    members?: TeamMemberUpdateManyWithoutTeamNestedInput
  }

  export type TeamUncheckedUpdateWithoutProjectsInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: TeamMemberUncheckedUpdateManyWithoutTeamNestedInput
  }

  export type ProjectMemberUpsertWithWhereUniqueWithoutProjectInput = {
    where: ProjectMemberWhereUniqueInput
    update: XOR<ProjectMemberUpdateWithoutProjectInput, ProjectMemberUncheckedUpdateWithoutProjectInput>
    create: XOR<ProjectMemberCreateWithoutProjectInput, ProjectMemberUncheckedCreateWithoutProjectInput>
  }

  export type ProjectMemberUpdateWithWhereUniqueWithoutProjectInput = {
    where: ProjectMemberWhereUniqueInput
    data: XOR<ProjectMemberUpdateWithoutProjectInput, ProjectMemberUncheckedUpdateWithoutProjectInput>
  }

  export type ProjectMemberUpdateManyWithWhereWithoutProjectInput = {
    where: ProjectMemberScalarWhereInput
    data: XOR<ProjectMemberUpdateManyMutationInput, ProjectMemberUncheckedUpdateManyWithoutProjectInput>
  }

  export type MarketplaceAssetUpsertWithoutProjectInput = {
    update: XOR<MarketplaceAssetUpdateWithoutProjectInput, MarketplaceAssetUncheckedUpdateWithoutProjectInput>
    create: XOR<MarketplaceAssetCreateWithoutProjectInput, MarketplaceAssetUncheckedCreateWithoutProjectInput>
    where?: MarketplaceAssetWhereInput
  }

  export type MarketplaceAssetUpdateToOneWithWhereWithoutProjectInput = {
    where?: MarketplaceAssetWhereInput
    data: XOR<MarketplaceAssetUpdateWithoutProjectInput, MarketplaceAssetUncheckedUpdateWithoutProjectInput>
  }

  export type MarketplaceAssetUpdateWithoutProjectInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: MarketplaceAssetUpdatetagsInput | string[]
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublished?: BoolFieldUpdateOperationsInput | boolean
    cloneCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    author?: UserUpdateOneRequiredWithoutPublishedAssetsNestedInput
    clones?: ProjectCloneUpdateManyWithoutAssetNestedInput
  }

  export type MarketplaceAssetUncheckedUpdateWithoutProjectInput = {
    id?: StringFieldUpdateOperationsInput | string
    authorId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: MarketplaceAssetUpdatetagsInput | string[]
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublished?: BoolFieldUpdateOperationsInput | boolean
    cloneCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    clones?: ProjectCloneUncheckedUpdateManyWithoutAssetNestedInput
  }

  export type ProjectCloneUpsertWithoutClonedProjectInput = {
    update: XOR<ProjectCloneUpdateWithoutClonedProjectInput, ProjectCloneUncheckedUpdateWithoutClonedProjectInput>
    create: XOR<ProjectCloneCreateWithoutClonedProjectInput, ProjectCloneUncheckedCreateWithoutClonedProjectInput>
    where?: ProjectCloneWhereInput
  }

  export type ProjectCloneUpdateToOneWithWhereWithoutClonedProjectInput = {
    where?: ProjectCloneWhereInput
    data: XOR<ProjectCloneUpdateWithoutClonedProjectInput, ProjectCloneUncheckedUpdateWithoutClonedProjectInput>
  }

  export type ProjectCloneUpdateWithoutClonedProjectInput = {
    id?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    asset?: MarketplaceAssetUpdateOneRequiredWithoutClonesNestedInput
    clonedBy?: UserUpdateOneRequiredWithoutClonedProjectsNestedInput
  }

  export type ProjectCloneUncheckedUpdateWithoutClonedProjectInput = {
    id?: StringFieldUpdateOperationsInput | string
    sourceAssetId?: StringFieldUpdateOperationsInput | string
    clonedByUserId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectCreateWithoutMembersInput = {
    id?: string
    name: string
    description?: string | null
    thumbnailUrl?: string | null
    stateUrl?: string | null
    isPublic?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    team: TeamCreateNestedOneWithoutProjectsInput
    publishedAsset?: MarketplaceAssetCreateNestedOneWithoutProjectInput
    clonedFrom?: ProjectCloneCreateNestedOneWithoutClonedProjectInput
  }

  export type ProjectUncheckedCreateWithoutMembersInput = {
    id?: string
    teamId: string
    name: string
    description?: string | null
    thumbnailUrl?: string | null
    stateUrl?: string | null
    isPublic?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    publishedAsset?: MarketplaceAssetUncheckedCreateNestedOneWithoutProjectInput
    clonedFrom?: ProjectCloneUncheckedCreateNestedOneWithoutClonedProjectInput
  }

  export type ProjectCreateOrConnectWithoutMembersInput = {
    where: ProjectWhereUniqueInput
    create: XOR<ProjectCreateWithoutMembersInput, ProjectUncheckedCreateWithoutMembersInput>
  }

  export type UserCreateWithoutProjectMembershipsInput = {
    id?: string
    name?: string | null
    email?: string | null
    emailVerified?: Date | string | null
    image?: string | null
    password?: string | null
    bio?: string | null
    onboardingComplete?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    onboardingProgress?: OnboardingProgressCreateNestedOneWithoutUserInput
    organizations?: OrganizationMemberCreateNestedManyWithoutUserInput
    teamMemberships?: TeamMemberCreateNestedManyWithoutUserInput
    publishedAssets?: MarketplaceAssetCreateNestedManyWithoutAuthorInput
    clonedProjects?: ProjectCloneCreateNestedManyWithoutClonedByInput
  }

  export type UserUncheckedCreateWithoutProjectMembershipsInput = {
    id?: string
    name?: string | null
    email?: string | null
    emailVerified?: Date | string | null
    image?: string | null
    password?: string | null
    bio?: string | null
    onboardingComplete?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    onboardingProgress?: OnboardingProgressUncheckedCreateNestedOneWithoutUserInput
    organizations?: OrganizationMemberUncheckedCreateNestedManyWithoutUserInput
    teamMemberships?: TeamMemberUncheckedCreateNestedManyWithoutUserInput
    publishedAssets?: MarketplaceAssetUncheckedCreateNestedManyWithoutAuthorInput
    clonedProjects?: ProjectCloneUncheckedCreateNestedManyWithoutClonedByInput
  }

  export type UserCreateOrConnectWithoutProjectMembershipsInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutProjectMembershipsInput, UserUncheckedCreateWithoutProjectMembershipsInput>
  }

  export type ProjectUpsertWithoutMembersInput = {
    update: XOR<ProjectUpdateWithoutMembersInput, ProjectUncheckedUpdateWithoutMembersInput>
    create: XOR<ProjectCreateWithoutMembersInput, ProjectUncheckedCreateWithoutMembersInput>
    where?: ProjectWhereInput
  }

  export type ProjectUpdateToOneWithWhereWithoutMembersInput = {
    where?: ProjectWhereInput
    data: XOR<ProjectUpdateWithoutMembersInput, ProjectUncheckedUpdateWithoutMembersInput>
  }

  export type ProjectUpdateWithoutMembersInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    stateUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    team?: TeamUpdateOneRequiredWithoutProjectsNestedInput
    publishedAsset?: MarketplaceAssetUpdateOneWithoutProjectNestedInput
    clonedFrom?: ProjectCloneUpdateOneWithoutClonedProjectNestedInput
  }

  export type ProjectUncheckedUpdateWithoutMembersInput = {
    id?: StringFieldUpdateOperationsInput | string
    teamId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    stateUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    publishedAsset?: MarketplaceAssetUncheckedUpdateOneWithoutProjectNestedInput
    clonedFrom?: ProjectCloneUncheckedUpdateOneWithoutClonedProjectNestedInput
  }

  export type UserUpsertWithoutProjectMembershipsInput = {
    update: XOR<UserUpdateWithoutProjectMembershipsInput, UserUncheckedUpdateWithoutProjectMembershipsInput>
    create: XOR<UserCreateWithoutProjectMembershipsInput, UserUncheckedCreateWithoutProjectMembershipsInput>
    where?: UserWhereInput
  }

  export type UserUpdateToOneWithWhereWithoutProjectMembershipsInput = {
    where?: UserWhereInput
    data: XOR<UserUpdateWithoutProjectMembershipsInput, UserUncheckedUpdateWithoutProjectMembershipsInput>
  }

  export type UserUpdateWithoutProjectMembershipsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    onboardingProgress?: OnboardingProgressUpdateOneWithoutUserNestedInput
    organizations?: OrganizationMemberUpdateManyWithoutUserNestedInput
    teamMemberships?: TeamMemberUpdateManyWithoutUserNestedInput
    publishedAssets?: MarketplaceAssetUpdateManyWithoutAuthorNestedInput
    clonedProjects?: ProjectCloneUpdateManyWithoutClonedByNestedInput
  }

  export type UserUncheckedUpdateWithoutProjectMembershipsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    onboardingProgress?: OnboardingProgressUncheckedUpdateOneWithoutUserNestedInput
    organizations?: OrganizationMemberUncheckedUpdateManyWithoutUserNestedInput
    teamMemberships?: TeamMemberUncheckedUpdateManyWithoutUserNestedInput
    publishedAssets?: MarketplaceAssetUncheckedUpdateManyWithoutAuthorNestedInput
    clonedProjects?: ProjectCloneUncheckedUpdateManyWithoutClonedByNestedInput
  }

  export type ProjectCreateWithoutPublishedAssetInput = {
    id?: string
    name: string
    description?: string | null
    thumbnailUrl?: string | null
    stateUrl?: string | null
    isPublic?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    team: TeamCreateNestedOneWithoutProjectsInput
    members?: ProjectMemberCreateNestedManyWithoutProjectInput
    clonedFrom?: ProjectCloneCreateNestedOneWithoutClonedProjectInput
  }

  export type ProjectUncheckedCreateWithoutPublishedAssetInput = {
    id?: string
    teamId: string
    name: string
    description?: string | null
    thumbnailUrl?: string | null
    stateUrl?: string | null
    isPublic?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    members?: ProjectMemberUncheckedCreateNestedManyWithoutProjectInput
    clonedFrom?: ProjectCloneUncheckedCreateNestedOneWithoutClonedProjectInput
  }

  export type ProjectCreateOrConnectWithoutPublishedAssetInput = {
    where: ProjectWhereUniqueInput
    create: XOR<ProjectCreateWithoutPublishedAssetInput, ProjectUncheckedCreateWithoutPublishedAssetInput>
  }

  export type UserCreateWithoutPublishedAssetsInput = {
    id?: string
    name?: string | null
    email?: string | null
    emailVerified?: Date | string | null
    image?: string | null
    password?: string | null
    bio?: string | null
    onboardingComplete?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    onboardingProgress?: OnboardingProgressCreateNestedOneWithoutUserInput
    organizations?: OrganizationMemberCreateNestedManyWithoutUserInput
    teamMemberships?: TeamMemberCreateNestedManyWithoutUserInput
    projectMemberships?: ProjectMemberCreateNestedManyWithoutUserInput
    clonedProjects?: ProjectCloneCreateNestedManyWithoutClonedByInput
  }

  export type UserUncheckedCreateWithoutPublishedAssetsInput = {
    id?: string
    name?: string | null
    email?: string | null
    emailVerified?: Date | string | null
    image?: string | null
    password?: string | null
    bio?: string | null
    onboardingComplete?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    onboardingProgress?: OnboardingProgressUncheckedCreateNestedOneWithoutUserInput
    organizations?: OrganizationMemberUncheckedCreateNestedManyWithoutUserInput
    teamMemberships?: TeamMemberUncheckedCreateNestedManyWithoutUserInput
    projectMemberships?: ProjectMemberUncheckedCreateNestedManyWithoutUserInput
    clonedProjects?: ProjectCloneUncheckedCreateNestedManyWithoutClonedByInput
  }

  export type UserCreateOrConnectWithoutPublishedAssetsInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutPublishedAssetsInput, UserUncheckedCreateWithoutPublishedAssetsInput>
  }

  export type ProjectCloneCreateWithoutAssetInput = {
    id?: string
    createdAt?: Date | string
    clonedProject: ProjectCreateNestedOneWithoutClonedFromInput
    clonedBy: UserCreateNestedOneWithoutClonedProjectsInput
  }

  export type ProjectCloneUncheckedCreateWithoutAssetInput = {
    id?: string
    clonedProjectId: string
    clonedByUserId: string
    createdAt?: Date | string
  }

  export type ProjectCloneCreateOrConnectWithoutAssetInput = {
    where: ProjectCloneWhereUniqueInput
    create: XOR<ProjectCloneCreateWithoutAssetInput, ProjectCloneUncheckedCreateWithoutAssetInput>
  }

  export type ProjectCloneCreateManyAssetInputEnvelope = {
    data: ProjectCloneCreateManyAssetInput | ProjectCloneCreateManyAssetInput[]
    skipDuplicates?: boolean
  }

  export type ProjectUpsertWithoutPublishedAssetInput = {
    update: XOR<ProjectUpdateWithoutPublishedAssetInput, ProjectUncheckedUpdateWithoutPublishedAssetInput>
    create: XOR<ProjectCreateWithoutPublishedAssetInput, ProjectUncheckedCreateWithoutPublishedAssetInput>
    where?: ProjectWhereInput
  }

  export type ProjectUpdateToOneWithWhereWithoutPublishedAssetInput = {
    where?: ProjectWhereInput
    data: XOR<ProjectUpdateWithoutPublishedAssetInput, ProjectUncheckedUpdateWithoutPublishedAssetInput>
  }

  export type ProjectUpdateWithoutPublishedAssetInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    stateUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    team?: TeamUpdateOneRequiredWithoutProjectsNestedInput
    members?: ProjectMemberUpdateManyWithoutProjectNestedInput
    clonedFrom?: ProjectCloneUpdateOneWithoutClonedProjectNestedInput
  }

  export type ProjectUncheckedUpdateWithoutPublishedAssetInput = {
    id?: StringFieldUpdateOperationsInput | string
    teamId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    stateUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: ProjectMemberUncheckedUpdateManyWithoutProjectNestedInput
    clonedFrom?: ProjectCloneUncheckedUpdateOneWithoutClonedProjectNestedInput
  }

  export type UserUpsertWithoutPublishedAssetsInput = {
    update: XOR<UserUpdateWithoutPublishedAssetsInput, UserUncheckedUpdateWithoutPublishedAssetsInput>
    create: XOR<UserCreateWithoutPublishedAssetsInput, UserUncheckedCreateWithoutPublishedAssetsInput>
    where?: UserWhereInput
  }

  export type UserUpdateToOneWithWhereWithoutPublishedAssetsInput = {
    where?: UserWhereInput
    data: XOR<UserUpdateWithoutPublishedAssetsInput, UserUncheckedUpdateWithoutPublishedAssetsInput>
  }

  export type UserUpdateWithoutPublishedAssetsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    onboardingProgress?: OnboardingProgressUpdateOneWithoutUserNestedInput
    organizations?: OrganizationMemberUpdateManyWithoutUserNestedInput
    teamMemberships?: TeamMemberUpdateManyWithoutUserNestedInput
    projectMemberships?: ProjectMemberUpdateManyWithoutUserNestedInput
    clonedProjects?: ProjectCloneUpdateManyWithoutClonedByNestedInput
  }

  export type UserUncheckedUpdateWithoutPublishedAssetsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    onboardingProgress?: OnboardingProgressUncheckedUpdateOneWithoutUserNestedInput
    organizations?: OrganizationMemberUncheckedUpdateManyWithoutUserNestedInput
    teamMemberships?: TeamMemberUncheckedUpdateManyWithoutUserNestedInput
    projectMemberships?: ProjectMemberUncheckedUpdateManyWithoutUserNestedInput
    clonedProjects?: ProjectCloneUncheckedUpdateManyWithoutClonedByNestedInput
  }

  export type ProjectCloneUpsertWithWhereUniqueWithoutAssetInput = {
    where: ProjectCloneWhereUniqueInput
    update: XOR<ProjectCloneUpdateWithoutAssetInput, ProjectCloneUncheckedUpdateWithoutAssetInput>
    create: XOR<ProjectCloneCreateWithoutAssetInput, ProjectCloneUncheckedCreateWithoutAssetInput>
  }

  export type ProjectCloneUpdateWithWhereUniqueWithoutAssetInput = {
    where: ProjectCloneWhereUniqueInput
    data: XOR<ProjectCloneUpdateWithoutAssetInput, ProjectCloneUncheckedUpdateWithoutAssetInput>
  }

  export type ProjectCloneUpdateManyWithWhereWithoutAssetInput = {
    where: ProjectCloneScalarWhereInput
    data: XOR<ProjectCloneUpdateManyMutationInput, ProjectCloneUncheckedUpdateManyWithoutAssetInput>
  }

  export type MarketplaceAssetCreateWithoutClonesInput = {
    id?: string
    title: string
    description?: string | null
    tags?: MarketplaceAssetCreatetagsInput | string[]
    thumbnailUrl?: string | null
    isPublished?: boolean
    cloneCount?: number
    createdAt?: Date | string
    updatedAt?: Date | string
    project: ProjectCreateNestedOneWithoutPublishedAssetInput
    author: UserCreateNestedOneWithoutPublishedAssetsInput
  }

  export type MarketplaceAssetUncheckedCreateWithoutClonesInput = {
    id?: string
    projectId: string
    authorId: string
    title: string
    description?: string | null
    tags?: MarketplaceAssetCreatetagsInput | string[]
    thumbnailUrl?: string | null
    isPublished?: boolean
    cloneCount?: number
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type MarketplaceAssetCreateOrConnectWithoutClonesInput = {
    where: MarketplaceAssetWhereUniqueInput
    create: XOR<MarketplaceAssetCreateWithoutClonesInput, MarketplaceAssetUncheckedCreateWithoutClonesInput>
  }

  export type ProjectCreateWithoutClonedFromInput = {
    id?: string
    name: string
    description?: string | null
    thumbnailUrl?: string | null
    stateUrl?: string | null
    isPublic?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    team: TeamCreateNestedOneWithoutProjectsInput
    members?: ProjectMemberCreateNestedManyWithoutProjectInput
    publishedAsset?: MarketplaceAssetCreateNestedOneWithoutProjectInput
  }

  export type ProjectUncheckedCreateWithoutClonedFromInput = {
    id?: string
    teamId: string
    name: string
    description?: string | null
    thumbnailUrl?: string | null
    stateUrl?: string | null
    isPublic?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    members?: ProjectMemberUncheckedCreateNestedManyWithoutProjectInput
    publishedAsset?: MarketplaceAssetUncheckedCreateNestedOneWithoutProjectInput
  }

  export type ProjectCreateOrConnectWithoutClonedFromInput = {
    where: ProjectWhereUniqueInput
    create: XOR<ProjectCreateWithoutClonedFromInput, ProjectUncheckedCreateWithoutClonedFromInput>
  }

  export type UserCreateWithoutClonedProjectsInput = {
    id?: string
    name?: string | null
    email?: string | null
    emailVerified?: Date | string | null
    image?: string | null
    password?: string | null
    bio?: string | null
    onboardingComplete?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    onboardingProgress?: OnboardingProgressCreateNestedOneWithoutUserInput
    organizations?: OrganizationMemberCreateNestedManyWithoutUserInput
    teamMemberships?: TeamMemberCreateNestedManyWithoutUserInput
    projectMemberships?: ProjectMemberCreateNestedManyWithoutUserInput
    publishedAssets?: MarketplaceAssetCreateNestedManyWithoutAuthorInput
  }

  export type UserUncheckedCreateWithoutClonedProjectsInput = {
    id?: string
    name?: string | null
    email?: string | null
    emailVerified?: Date | string | null
    image?: string | null
    password?: string | null
    bio?: string | null
    onboardingComplete?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    onboardingProgress?: OnboardingProgressUncheckedCreateNestedOneWithoutUserInput
    organizations?: OrganizationMemberUncheckedCreateNestedManyWithoutUserInput
    teamMemberships?: TeamMemberUncheckedCreateNestedManyWithoutUserInput
    projectMemberships?: ProjectMemberUncheckedCreateNestedManyWithoutUserInput
    publishedAssets?: MarketplaceAssetUncheckedCreateNestedManyWithoutAuthorInput
  }

  export type UserCreateOrConnectWithoutClonedProjectsInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutClonedProjectsInput, UserUncheckedCreateWithoutClonedProjectsInput>
  }

  export type MarketplaceAssetUpsertWithoutClonesInput = {
    update: XOR<MarketplaceAssetUpdateWithoutClonesInput, MarketplaceAssetUncheckedUpdateWithoutClonesInput>
    create: XOR<MarketplaceAssetCreateWithoutClonesInput, MarketplaceAssetUncheckedCreateWithoutClonesInput>
    where?: MarketplaceAssetWhereInput
  }

  export type MarketplaceAssetUpdateToOneWithWhereWithoutClonesInput = {
    where?: MarketplaceAssetWhereInput
    data: XOR<MarketplaceAssetUpdateWithoutClonesInput, MarketplaceAssetUncheckedUpdateWithoutClonesInput>
  }

  export type MarketplaceAssetUpdateWithoutClonesInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: MarketplaceAssetUpdatetagsInput | string[]
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublished?: BoolFieldUpdateOperationsInput | boolean
    cloneCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    project?: ProjectUpdateOneRequiredWithoutPublishedAssetNestedInput
    author?: UserUpdateOneRequiredWithoutPublishedAssetsNestedInput
  }

  export type MarketplaceAssetUncheckedUpdateWithoutClonesInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    authorId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: MarketplaceAssetUpdatetagsInput | string[]
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublished?: BoolFieldUpdateOperationsInput | boolean
    cloneCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectUpsertWithoutClonedFromInput = {
    update: XOR<ProjectUpdateWithoutClonedFromInput, ProjectUncheckedUpdateWithoutClonedFromInput>
    create: XOR<ProjectCreateWithoutClonedFromInput, ProjectUncheckedCreateWithoutClonedFromInput>
    where?: ProjectWhereInput
  }

  export type ProjectUpdateToOneWithWhereWithoutClonedFromInput = {
    where?: ProjectWhereInput
    data: XOR<ProjectUpdateWithoutClonedFromInput, ProjectUncheckedUpdateWithoutClonedFromInput>
  }

  export type ProjectUpdateWithoutClonedFromInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    stateUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    team?: TeamUpdateOneRequiredWithoutProjectsNestedInput
    members?: ProjectMemberUpdateManyWithoutProjectNestedInput
    publishedAsset?: MarketplaceAssetUpdateOneWithoutProjectNestedInput
  }

  export type ProjectUncheckedUpdateWithoutClonedFromInput = {
    id?: StringFieldUpdateOperationsInput | string
    teamId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    stateUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: ProjectMemberUncheckedUpdateManyWithoutProjectNestedInput
    publishedAsset?: MarketplaceAssetUncheckedUpdateOneWithoutProjectNestedInput
  }

  export type UserUpsertWithoutClonedProjectsInput = {
    update: XOR<UserUpdateWithoutClonedProjectsInput, UserUncheckedUpdateWithoutClonedProjectsInput>
    create: XOR<UserCreateWithoutClonedProjectsInput, UserUncheckedCreateWithoutClonedProjectsInput>
    where?: UserWhereInput
  }

  export type UserUpdateToOneWithWhereWithoutClonedProjectsInput = {
    where?: UserWhereInput
    data: XOR<UserUpdateWithoutClonedProjectsInput, UserUncheckedUpdateWithoutClonedProjectsInput>
  }

  export type UserUpdateWithoutClonedProjectsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    onboardingProgress?: OnboardingProgressUpdateOneWithoutUserNestedInput
    organizations?: OrganizationMemberUpdateManyWithoutUserNestedInput
    teamMemberships?: TeamMemberUpdateManyWithoutUserNestedInput
    projectMemberships?: ProjectMemberUpdateManyWithoutUserNestedInput
    publishedAssets?: MarketplaceAssetUpdateManyWithoutAuthorNestedInput
  }

  export type UserUncheckedUpdateWithoutClonedProjectsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: NullableStringFieldUpdateOperationsInput | string | null
    email?: NullableStringFieldUpdateOperationsInput | string | null
    emailVerified?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    image?: NullableStringFieldUpdateOperationsInput | string | null
    password?: NullableStringFieldUpdateOperationsInput | string | null
    bio?: NullableStringFieldUpdateOperationsInput | string | null
    onboardingComplete?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    onboardingProgress?: OnboardingProgressUncheckedUpdateOneWithoutUserNestedInput
    organizations?: OrganizationMemberUncheckedUpdateManyWithoutUserNestedInput
    teamMemberships?: TeamMemberUncheckedUpdateManyWithoutUserNestedInput
    projectMemberships?: ProjectMemberUncheckedUpdateManyWithoutUserNestedInput
    publishedAssets?: MarketplaceAssetUncheckedUpdateManyWithoutAuthorNestedInput
  }

  export type OrganizationMemberCreateManyUserInput = {
    id?: string
    organizationId: string
    role?: $Enums.OrgRole
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TeamMemberCreateManyUserInput = {
    id?: string
    teamId: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ProjectMemberCreateManyUserInput = {
    id?: string
    projectId: string
    role?: $Enums.ProjectRole
    createdAt?: Date | string
  }

  export type MarketplaceAssetCreateManyAuthorInput = {
    id?: string
    projectId: string
    title: string
    description?: string | null
    tags?: MarketplaceAssetCreatetagsInput | string[]
    thumbnailUrl?: string | null
    isPublished?: boolean
    cloneCount?: number
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ProjectCloneCreateManyClonedByInput = {
    id?: string
    sourceAssetId: string
    clonedProjectId: string
    createdAt?: Date | string
  }

  export type OrganizationMemberUpdateWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    role?: EnumOrgRoleFieldUpdateOperationsInput | $Enums.OrgRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    organization?: OrganizationUpdateOneRequiredWithoutMembersNestedInput
  }

  export type OrganizationMemberUncheckedUpdateWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    role?: EnumOrgRoleFieldUpdateOperationsInput | $Enums.OrgRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationMemberUncheckedUpdateManyWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    organizationId?: StringFieldUpdateOperationsInput | string
    role?: EnumOrgRoleFieldUpdateOperationsInput | $Enums.OrgRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TeamMemberUpdateWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    team?: TeamUpdateOneRequiredWithoutMembersNestedInput
  }

  export type TeamMemberUncheckedUpdateWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    teamId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TeamMemberUncheckedUpdateManyWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    teamId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectMemberUpdateWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    role?: EnumProjectRoleFieldUpdateOperationsInput | $Enums.ProjectRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    project?: ProjectUpdateOneRequiredWithoutMembersNestedInput
  }

  export type ProjectMemberUncheckedUpdateWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    role?: EnumProjectRoleFieldUpdateOperationsInput | $Enums.ProjectRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectMemberUncheckedUpdateManyWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    role?: EnumProjectRoleFieldUpdateOperationsInput | $Enums.ProjectRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type MarketplaceAssetUpdateWithoutAuthorInput = {
    id?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: MarketplaceAssetUpdatetagsInput | string[]
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublished?: BoolFieldUpdateOperationsInput | boolean
    cloneCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    project?: ProjectUpdateOneRequiredWithoutPublishedAssetNestedInput
    clones?: ProjectCloneUpdateManyWithoutAssetNestedInput
  }

  export type MarketplaceAssetUncheckedUpdateWithoutAuthorInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: MarketplaceAssetUpdatetagsInput | string[]
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublished?: BoolFieldUpdateOperationsInput | boolean
    cloneCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    clones?: ProjectCloneUncheckedUpdateManyWithoutAssetNestedInput
  }

  export type MarketplaceAssetUncheckedUpdateManyWithoutAuthorInput = {
    id?: StringFieldUpdateOperationsInput | string
    projectId?: StringFieldUpdateOperationsInput | string
    title?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    tags?: MarketplaceAssetUpdatetagsInput | string[]
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublished?: BoolFieldUpdateOperationsInput | boolean
    cloneCount?: IntFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectCloneUpdateWithoutClonedByInput = {
    id?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    asset?: MarketplaceAssetUpdateOneRequiredWithoutClonesNestedInput
    clonedProject?: ProjectUpdateOneRequiredWithoutClonedFromNestedInput
  }

  export type ProjectCloneUncheckedUpdateWithoutClonedByInput = {
    id?: StringFieldUpdateOperationsInput | string
    sourceAssetId?: StringFieldUpdateOperationsInput | string
    clonedProjectId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectCloneUncheckedUpdateManyWithoutClonedByInput = {
    id?: StringFieldUpdateOperationsInput | string
    sourceAssetId?: StringFieldUpdateOperationsInput | string
    clonedProjectId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationMemberCreateManyOrganizationInput = {
    id?: string
    userId: string
    role?: $Enums.OrgRole
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TeamCreateManyOrganizationInput = {
    id?: string
    name: string
    description?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type OrganizationInviteTokenCreateManyOrganizationInput = {
    id?: string
    token?: string
    createdByUserId: string
    expiresAt: Date | string
    usedAt?: Date | string | null
    usedByUserId?: string | null
    createdAt?: Date | string
  }

  export type OrganizationMemberUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    role?: EnumOrgRoleFieldUpdateOperationsInput | $Enums.OrgRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    user?: UserUpdateOneRequiredWithoutOrganizationsNestedInput
  }

  export type OrganizationMemberUncheckedUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    role?: EnumOrgRoleFieldUpdateOperationsInput | $Enums.OrgRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationMemberUncheckedUpdateManyWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    role?: EnumOrgRoleFieldUpdateOperationsInput | $Enums.OrgRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TeamUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: TeamMemberUpdateManyWithoutTeamNestedInput
    projects?: ProjectUpdateManyWithoutTeamNestedInput
  }

  export type TeamUncheckedUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: TeamMemberUncheckedUpdateManyWithoutTeamNestedInput
    projects?: ProjectUncheckedUpdateManyWithoutTeamNestedInput
  }

  export type TeamUncheckedUpdateManyWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationInviteTokenUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    token?: StringFieldUpdateOperationsInput | string
    createdByUserId?: StringFieldUpdateOperationsInput | string
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    usedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    usedByUserId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationInviteTokenUncheckedUpdateWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    token?: StringFieldUpdateOperationsInput | string
    createdByUserId?: StringFieldUpdateOperationsInput | string
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    usedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    usedByUserId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type OrganizationInviteTokenUncheckedUpdateManyWithoutOrganizationInput = {
    id?: StringFieldUpdateOperationsInput | string
    token?: StringFieldUpdateOperationsInput | string
    createdByUserId?: StringFieldUpdateOperationsInput | string
    expiresAt?: DateTimeFieldUpdateOperationsInput | Date | string
    usedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    usedByUserId?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TeamMemberCreateManyTeamInput = {
    id?: string
    userId: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type ProjectCreateManyTeamInput = {
    id?: string
    name: string
    description?: string | null
    thumbnailUrl?: string | null
    stateUrl?: string | null
    isPublic?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TeamMemberUpdateWithoutTeamInput = {
    id?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    user?: UserUpdateOneRequiredWithoutTeamMembershipsNestedInput
  }

  export type TeamMemberUncheckedUpdateWithoutTeamInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TeamMemberUncheckedUpdateManyWithoutTeamInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectUpdateWithoutTeamInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    stateUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: ProjectMemberUpdateManyWithoutProjectNestedInput
    publishedAsset?: MarketplaceAssetUpdateOneWithoutProjectNestedInput
    clonedFrom?: ProjectCloneUpdateOneWithoutClonedProjectNestedInput
  }

  export type ProjectUncheckedUpdateWithoutTeamInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    stateUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    members?: ProjectMemberUncheckedUpdateManyWithoutProjectNestedInput
    publishedAsset?: MarketplaceAssetUncheckedUpdateOneWithoutProjectNestedInput
    clonedFrom?: ProjectCloneUncheckedUpdateOneWithoutClonedProjectNestedInput
  }

  export type ProjectUncheckedUpdateManyWithoutTeamInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    thumbnailUrl?: NullableStringFieldUpdateOperationsInput | string | null
    stateUrl?: NullableStringFieldUpdateOperationsInput | string | null
    isPublic?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectMemberCreateManyProjectInput = {
    id?: string
    userId: string
    role?: $Enums.ProjectRole
    createdAt?: Date | string
  }

  export type ProjectMemberUpdateWithoutProjectInput = {
    id?: StringFieldUpdateOperationsInput | string
    role?: EnumProjectRoleFieldUpdateOperationsInput | $Enums.ProjectRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    user?: UserUpdateOneRequiredWithoutProjectMembershipsNestedInput
  }

  export type ProjectMemberUncheckedUpdateWithoutProjectInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    role?: EnumProjectRoleFieldUpdateOperationsInput | $Enums.ProjectRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectMemberUncheckedUpdateManyWithoutProjectInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    role?: EnumProjectRoleFieldUpdateOperationsInput | $Enums.ProjectRole
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectCloneCreateManyAssetInput = {
    id?: string
    clonedProjectId: string
    clonedByUserId: string
    createdAt?: Date | string
  }

  export type ProjectCloneUpdateWithoutAssetInput = {
    id?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    clonedProject?: ProjectUpdateOneRequiredWithoutClonedFromNestedInput
    clonedBy?: UserUpdateOneRequiredWithoutClonedProjectsNestedInput
  }

  export type ProjectCloneUncheckedUpdateWithoutAssetInput = {
    id?: StringFieldUpdateOperationsInput | string
    clonedProjectId?: StringFieldUpdateOperationsInput | string
    clonedByUserId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type ProjectCloneUncheckedUpdateManyWithoutAssetInput = {
    id?: StringFieldUpdateOperationsInput | string
    clonedProjectId?: StringFieldUpdateOperationsInput | string
    clonedByUserId?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }



  /**
   * Aliases for legacy arg types
   */
    /**
     * @deprecated Use UserCountOutputTypeDefaultArgs instead
     */
    export type UserCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = UserCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use OrganizationCountOutputTypeDefaultArgs instead
     */
    export type OrganizationCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = OrganizationCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TeamCountOutputTypeDefaultArgs instead
     */
    export type TeamCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TeamCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ProjectCountOutputTypeDefaultArgs instead
     */
    export type ProjectCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ProjectCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use MarketplaceAssetCountOutputTypeDefaultArgs instead
     */
    export type MarketplaceAssetCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = MarketplaceAssetCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use UserDefaultArgs instead
     */
    export type UserArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = UserDefaultArgs<ExtArgs>
    /**
     * @deprecated Use OnboardingProgressDefaultArgs instead
     */
    export type OnboardingProgressArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = OnboardingProgressDefaultArgs<ExtArgs>
    /**
     * @deprecated Use OrganizationDefaultArgs instead
     */
    export type OrganizationArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = OrganizationDefaultArgs<ExtArgs>
    /**
     * @deprecated Use OrganizationMemberDefaultArgs instead
     */
    export type OrganizationMemberArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = OrganizationMemberDefaultArgs<ExtArgs>
    /**
     * @deprecated Use OrganizationInviteTokenDefaultArgs instead
     */
    export type OrganizationInviteTokenArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = OrganizationInviteTokenDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TeamDefaultArgs instead
     */
    export type TeamArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TeamDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TeamMemberDefaultArgs instead
     */
    export type TeamMemberArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TeamMemberDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ProjectDefaultArgs instead
     */
    export type ProjectArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ProjectDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ProjectMemberDefaultArgs instead
     */
    export type ProjectMemberArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ProjectMemberDefaultArgs<ExtArgs>
    /**
     * @deprecated Use MarketplaceAssetDefaultArgs instead
     */
    export type MarketplaceAssetArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = MarketplaceAssetDefaultArgs<ExtArgs>
    /**
     * @deprecated Use ProjectCloneDefaultArgs instead
     */
    export type ProjectCloneArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = ProjectCloneDefaultArgs<ExtArgs>
    /**
     * @deprecated Use EarlyAccessApplicationDefaultArgs instead
     */
    export type EarlyAccessApplicationArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = EarlyAccessApplicationDefaultArgs<ExtArgs>
    /**
     * @deprecated Use PasswordResetTokenDefaultArgs instead
     */
    export type PasswordResetTokenArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = PasswordResetTokenDefaultArgs<ExtArgs>

  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}