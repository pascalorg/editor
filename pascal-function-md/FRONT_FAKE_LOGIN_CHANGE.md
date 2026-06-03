# Front Fake Login Change

Date: 2026-06-01

## Summary

Added a front-end only fake login flow for the custom reverse-proxy front page. The login page now writes a local browser login flag after successful input validation, and the custom home page redirects unauthenticated users to the login page.

## Files Changed

Total changed files: 2

- `pascal-reverse-front/login.html`
  - Added local auth storage keys: `measurenavi_auth` and `measurenavi_user`.
  - Changed login success behavior to accept any non-empty account and password.
  - Stores a simple fake user profile in `localStorage`.
  - Redirects to `/` after fake login succeeds.

- `pascal-reverse-front/index.html`
  - Added a front-end auth guard.
  - Redirects to `/login.html` when `measurenavi_auth` is not present.

## Behavior

- Open the proxy home page:

```text
http://localhost:8000/
```

- If not logged in, the browser is redirected to:

```text
http://localhost:8000/login.html
```

- Entering any non-empty account and password creates a fake login session in browser `localStorage` and returns to the custom home page.

## Notes

- This is not real authentication.
- No backend auth API was added.
- No Pascal editor source code was changed.
- Existing scene list, cover upload, and editor jump behavior remain unchanged.
