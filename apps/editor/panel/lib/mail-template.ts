/**
 * The house style for transactional mail, as one function.
 *
 * Mail clients are not browsers: no external stylesheet survives, Outlook lays
 * out with Word, and Gmail drops anything it does not recognise. So this is
 * table-based with inline styles — the two things every client agrees on. The
 * only `<style>` block carries the dark-scheme overrides, which Apple Mail and
 * iOS honour and everyone else ignores harmlessly.
 *
 * The palette is the console's: brand #ffc629, hairline borders, a mono
 * micro-label above the heading. Colours are hex rather than the app's oklch
 * tokens because mail clients do not parse oklch.
 */

const BRAND = '#ffc629'

const LIGHT = {
  page: '#f4f4f5',
  card: '#ffffff',
  border: '#e4e4e7',
  fg: '#18181b',
  muted: '#71717a',
  field: '#fafafa',
}

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface MailPage {
  /** Mono micro-label above the heading — the console's `Caps` treatment. */
  label: string
  heading: string
  /** Lead paragraph. Plain text; it is escaped here. */
  intro: string
  action?: { label: string; url: string }
  /** Small print under the button — validity window, and what to do if unexpected. */
  note?: string
  /** Shown in a bordered box, e.g. a temporary password. */
  callout?: { label: string; value: string }
  /** Preview line shown by inboxes before the message is opened. */
  preheader: string
  footer: string
}

export function renderMail(page: MailPage): string {
  const action = page.action
    ? `
              <tr>
                <td style="padding: 26px 0 0 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td bgcolor="${BRAND}" style="border-radius: 10px;">
                        <a href="${escapeHtml(page.action.url)}"
                           style="display: inline-block; padding: 13px 22px; font-family: ${SANS}; font-size: 14px; font-weight: 600; line-height: 1; color: #18181b; text-decoration: none; border-radius: 10px;">${escapeHtml(page.action.label)}</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
    : ''

  // Clients that strip the button still need a usable link, and a long URL has
  // to be allowed to break or it widens the whole table on a phone.
  const fallback = page.action
    ? `
              <tr>
                <td style="padding: 22px 0 0 0;">
                  <div class="dt-hint" style="font-family: ${SANS}; font-size: 12px; line-height: 1.5; color: ${LIGHT.muted}; padding-bottom: 7px;">
                    Or paste this address into your browser:
                  </div>
                  <div class="dt-field" style="font-family: ${MONO}; font-size: 12px; line-height: 1.6; color: ${LIGHT.fg}; background: ${LIGHT.field}; border: 1px solid ${LIGHT.border}; border-radius: 8px; padding: 11px 13px; word-break: break-all;">${escapeHtml(page.action.url)}</div>
                </td>
              </tr>`
    : ''

  const callout = page.callout
    ? `
              <tr>
                <td style="padding: 22px 0 0 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="dt-field"
                         style="background: ${LIGHT.field}; border: 1px solid ${LIGHT.border}; border-radius: 10px;">
                    <tr>
                      <td style="padding: 13px 15px;">
                        <div class="dt-hint" style="font-family: ${MONO}; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: ${LIGHT.muted}; padding-bottom: 6px;">${escapeHtml(page.callout.label)}</div>
                        <div style="font-family: ${MONO}; font-size: 15px; font-weight: 600; color: ${LIGHT.fg}; word-break: break-all;">${escapeHtml(page.callout.value)}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
    : ''

  const note = page.note
    ? `
              <tr>
                <td class="dt-hint" style="padding: 20px 0 0 0; font-family: ${SANS}; font-size: 12.5px; line-height: 1.6; color: ${LIGHT.muted};">${escapeHtml(page.note)}</td>
              </tr>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(page.heading)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .dt-page { background: #18181b !important; }
    .dt-card { background: #232326 !important; border-color: #303034 !important; }
    .dt-fg { color: #fafafa !important; }
    .dt-hint { color: #a1a1aa !important; }
    .dt-rule { border-color: #303034 !important; }
    .dt-field { background: #1c1c1f !important; border-color: #303034 !important; color: #fafafa !important; }
  }
  @media only screen and (max-width: 600px) {
    .dt-card-pad { padding: 24px 20px !important; }
  }
</style>
</head>
<body class="dt-page" style="margin: 0; padding: 0; background: ${LIGHT.page}; -webkit-text-size-adjust: 100%;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(page.preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="dt-page" style="background: ${LIGHT.page};">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="dt-card"
               style="max-width: 520px; background: ${LIGHT.card}; border: 1px solid ${LIGHT.border}; border-radius: 14px;">
          <tr>
            <td class="dt-card-pad" style="padding: 28px 30px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-right: 10px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="26" height="26" bgcolor="${BRAND}" style="width: 26px; height: 26px; border-radius: 7px;"></td>
                      </tr>
                    </table>
                  </td>
                  <td class="dt-fg" style="font-family: ${SANS}; font-size: 15px; font-weight: 600; color: ${LIGHT.fg}; letter-spacing: -0.01em;">DigitalTwin</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td class="dt-rule" style="padding: 22px 0 0 0; border-bottom: 1px solid ${LIGHT.border}; font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
                <tr>
                  <td class="dt-hint" style="padding: 22px 0 0 0; font-family: ${MONO}; font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase; color: ${LIGHT.muted};">${escapeHtml(page.label)}</td>
                </tr>
                <tr>
                  <td class="dt-fg" style="padding: 9px 0 0 0; font-family: ${SANS}; font-size: 21px; font-weight: 600; line-height: 1.3; color: ${LIGHT.fg}; letter-spacing: -0.015em;">${escapeHtml(page.heading)}</td>
                </tr>
                <tr>
                  <td class="dt-hint" style="padding: 11px 0 0 0; font-family: ${SANS}; font-size: 14px; line-height: 1.65; color: ${LIGHT.muted};">${escapeHtml(page.intro)}</td>
                </tr>${callout}${action}${fallback}${note}
              </table>
            </td>
          </tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 520px;">
          <tr>
            <td class="dt-hint" align="center" style="padding: 18px 8px 0 8px; font-family: ${MONO}; font-size: 10.5px; line-height: 1.7; color: ${LIGHT.muted};">${escapeHtml(page.footer).replace(/\n/g, '<br>')}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
