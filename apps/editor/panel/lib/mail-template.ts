import type { Lang } from './types'

/**
 * The house style for transactional mail, as one function.
 *
 * Mail clients are not browsers: no external stylesheet survives, Outlook lays
 * out with Word, and Gmail drops anything it does not recognise. So this is
 * table-based with inline styles — the two things every client agrees on. The
 * only `<style>` block carries the dark-scheme and small-screen overrides,
 * which the clients that support them honour and everyone else ignores.
 *
 * The palette and the rhythm are the console's: hairline borders, a quiet mono
 * micro-label, amber reserved for the single action, and facts set as labelled
 * rows rather than buried in a sentence. Colours are hex rather than the app's
 * oklch tokens because mail clients do not parse oklch.
 */

const BRAND = '#ffc629'

const LIGHT = {
  page: '#f4f4f5',
  card: '#ffffff',
  border: '#e4e4e7',
  hairline: '#f0f0f1',
  fg: '#18181b',
  muted: '#6b6b73',
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

/** Copy that belongs to the frame rather than to any one message. */
const CHROME: Record<Lang, { paste: string; automated: string }> = {
  en: {
    paste: 'Or paste this address into your browser',
    automated: 'This message was sent automatically. Please do not reply.',
  },
  tr: {
    paste: 'Ya da bu adresi tarayıcınıza yapıştırın',
    automated: 'Bu ileti otomatik olarak gönderildi. Lütfen yanıtlamayın.',
  },
}

export interface MailFact {
  label: string
  value: string
}

export interface MailPage {
  /** Absolute origin, so the logo and footer link resolve in a mail client. */
  origin: string
  /** Drives the `lang` attribute and the frame's own wording. */
  lang: Lang
  /** Mono micro-label above the heading — the console's `Caps` treatment. */
  label: string
  heading: string
  /** Lead paragraph. Plain text; it is escaped here. */
  intro: string
  action?: { label: string; url: string }
  /**
   * Labelled rows under the lead — when, which account, which device. A
   * security notice is only useful if the reader can check it against what
   * they remember doing, and prose hides those details.
   */
  facts?: MailFact[]
  /** Small print under the button — validity window, and what to do if unexpected. */
  note?: string
  /** Shown in a bordered box, e.g. a temporary password. */
  callout?: { label: string; value: string }
  /** Preview line shown by inboxes before the message is opened. */
  preheader: string
  footer: string
}

/**
 * Outlook on Windows renders with Word, which ignores padding on an anchor —
 * a styled button collapses to bare underlined text. The VML rectangle behind
 * this conditional comment is the standard remedy; every other client skips it.
 */
function button(action: { label: string; url: string }): string {
  const href = escapeHtml(action.url)
  const label = escapeHtml(action.label)
  return `
              <tr>
                <td style="padding: 24px 0 0 0;">
                  <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                               href="${href}" style="height:42px;v-text-anchor:middle;width:230px;" arcsize="24%" stroke="f" fillcolor="${BRAND}">
                    <w:anchorlock/>
                    <center style="color:#18181b;font-family:${SANS};font-size:14px;font-weight:600;">${label}</center>
                  </v:roundrect>
                  <![endif]-->
                  <!--[if !mso]><!-- -->
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td bgcolor="${BRAND}" style="border-radius: 8px;">
                        <a href="${href}"
                           style="display: inline-block; padding: 12px 20px; font-family: ${SANS}; font-size: 14px; font-weight: 600; line-height: 1; color: #18181b; text-decoration: none; border-radius: 8px;">${label}</a>
                      </td>
                    </tr>
                  </table>
                  <!--<![endif]-->
                </td>
              </tr>`
}

function factRows(facts: MailFact[]): string {
  const rows = facts
    .map(
      (fact, index) => `
                      <tr>
                        <td class="dt-rule" style="padding: ${index === 0 ? '0' : '9px'} 12px 9px 0; ${index === 0 ? '' : `border-top: 1px solid ${LIGHT.hairline};`} font-family: ${MONO}; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: ${LIGHT.muted}; white-space: nowrap; vertical-align: top;" class="dt-hint">${escapeHtml(fact.label)}</td>
                        <td class="dt-rule dt-fg" style="padding: ${index === 0 ? '0' : '9px'} 0 9px 0; ${index === 0 ? '' : `border-top: 1px solid ${LIGHT.hairline};`} font-family: ${SANS}; font-size: 13.5px; line-height: 1.5; color: ${LIGHT.fg}; vertical-align: top;">${escapeHtml(fact.value)}</td>
                      </tr>`,
    )
    .join('')

  return `
              <tr>
                <td style="padding: 20px 0 0 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}
                  </table>
                </td>
              </tr>`
}

export function renderMail(page: MailPage): string {
  const chrome = CHROME[page.lang] ?? CHROME.en

  const action = page.action ? button(page.action) : ''

  // Clients that strip the button still need a usable link, and a long URL has
  // to be allowed to break or it widens the whole table on a phone.
  const fallback = page.action
    ? `
              <tr>
                <td style="padding: 20px 0 0 0;">
                  <div class="dt-hint" style="font-family: ${SANS}; font-size: 12px; line-height: 1.5; color: ${LIGHT.muted}; padding-bottom: 7px;">${chrome.paste}</div>
                  <div class="dt-field" style="font-family: ${MONO}; font-size: 11.5px; line-height: 1.6; color: ${LIGHT.fg}; background: ${LIGHT.field}; border: 1px solid ${LIGHT.border}; border-radius: 8px; padding: 10px 12px; word-break: break-all;">${escapeHtml(page.action.url)}</div>
                </td>
              </tr>`
    : ''

  const callout = page.callout
    ? `
              <tr>
                <td style="padding: 20px 0 0 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="dt-field"
                         style="background: ${LIGHT.field}; border: 1px solid ${LIGHT.border}; border-radius: 8px;">
                    <tr>
                      <td style="padding: 13px 15px;">
                        <div class="dt-hint" style="font-family: ${MONO}; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: ${LIGHT.muted}; padding-bottom: 6px;">${escapeHtml(page.callout.label)}</div>
                        <!-- dt-fg, not just the box's dt-field: an inline colour on this
                             element beats the colour it would otherwise inherit, and a
                             temporary password rendered near-black on near-black is a
                             message that cannot be read at all in dark mode. -->
                        <div class="dt-fg" style="font-family: ${MONO}; font-size: 16px; font-weight: 600; letter-spacing: 0.02em; color: ${LIGHT.fg}; word-break: break-all;">${escapeHtml(page.callout.value)}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
    : ''

  const facts = page.facts?.length ? factRows(page.facts) : ''

  const note = page.note
    ? `
              <tr>
                <td class="dt-hint" style="padding: 20px 0 0 0; font-family: ${SANS}; font-size: 12.5px; line-height: 1.6; color: ${LIGHT.muted};">${escapeHtml(page.note)}</td>
              </tr>`
    : ''

  return `<!doctype html>
<html lang="${page.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(page.heading)}</title>
<!--[if mso]><style>body,table,td,a{font-family:Arial,Helvetica,sans-serif !important}</style><![endif]-->
<style>
  @media (prefers-color-scheme: dark) {
    .dt-page { background: #131316 !important; }
    .dt-card { background: #1c1c1f !important; border-color: #2c2c31 !important; }
    .dt-fg { color: #fafafa !important; }
    .dt-hint { color: #a1a1aa !important; }
    .dt-rule { border-color: #2c2c31 !important; }
    .dt-field { background: #16161a !important; border-color: #2c2c31 !important; color: #fafafa !important; }
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
               style="max-width: 520px; background: ${LIGHT.card}; border: 1px solid ${LIGHT.border}; border-radius: 12px;">
          <tr>
            <td class="dt-card-pad" style="padding: 28px 30px 30px 30px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-right: 9px; line-height: 0;">
                    <img src="${escapeHtml(page.origin)}/brand/digitaltwin-mark.png"
                         width="30" height="22" alt="DigitalTwin"
                         style="display: block; width: 30px; height: 22px; border: 0;">
                  </td>
                  <td class="dt-fg" style="font-family: ${SANS}; font-size: 15px; font-weight: 600; color: ${LIGHT.fg}; letter-spacing: -0.01em;">DigitalTwin</td>
                </tr>
              </table>

              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td class="dt-rule" style="padding: 20px 0 0 0; border-bottom: 1px solid ${LIGHT.border}; font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>
                <tr>
                  <td class="dt-hint" style="padding: 20px 0 0 0; font-family: ${MONO}; font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase; color: ${LIGHT.muted};">${escapeHtml(page.label)}</td>
                </tr>
                <tr>
                  <td class="dt-fg" style="padding: 8px 0 0 0; font-family: ${SANS}; font-size: 20px; font-weight: 600; line-height: 1.35; color: ${LIGHT.fg}; letter-spacing: -0.015em;">${escapeHtml(page.heading)}</td>
                </tr>
                <tr>
                  <td class="dt-hint" style="padding: 10px 0 0 0; font-family: ${SANS}; font-size: 14px; line-height: 1.65; color: ${LIGHT.muted};">${escapeHtml(page.intro)}</td>
                </tr>${facts}${callout}${action}${fallback}${note}
              </table>
            </td>
          </tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 520px;">
          <tr>
            <td class="dt-hint" align="center" style="padding: 18px 8px 0 8px; font-family: ${SANS}; font-size: 11.5px; line-height: 1.7; color: ${LIGHT.muted};">${escapeHtml(page.footer).replace(/\n/g, '<br>')}<br>${chrome.automated}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
