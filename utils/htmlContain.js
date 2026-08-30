const catchAsync = require('./catchAsync');
const sendActualMail = require('./email');

exports.sendEmail = async (options) => {
  console.log('sendMail');
  const escapeHtml = (value = '') =>
    String(value ?? '').replace(/[&<>"']/g, (char) => {
      const entities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };

      return entities[char];
    });

  const buildMessageParagraphs = (message = '') => {
    const rawMessage = String(message ?? '').trim();

    if (!rawMessage) {
      return `<p style="margin:0;color:#d8e2f3;">We will keep you updated with the next steps shortly.</p>`;
    }

    const paragraphs = rawMessage
      .split(/\n{2,}/)
      .map((block) => block.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .flatMap((block) => {
        if (block.length <= 240) return [block];

        const sentences = block.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [block];
        const groupedParagraphs = [];
        let currentParagraph = '';

        sentences.forEach((sentence) => {
          const cleanSentence = sentence.trim();
          const nextParagraph = `${currentParagraph} ${cleanSentence}`.trim();

          if (nextParagraph.length > 240 && currentParagraph) {
            groupedParagraphs.push(currentParagraph);
            currentParagraph = cleanSentence;
            return;
          }

          currentParagraph = nextParagraph;
        });

        if (currentParagraph) groupedParagraphs.push(currentParagraph);

        return groupedParagraphs;
      });

    return paragraphs
      .map(
        (paragraph) =>
          `<p style="margin:0 0 18px;color:#d8e2f3;font-size:16px;line-height:1.75;">${escapeHtml(paragraph)}</p>`,
      )
      .join('');
  };

  const safeSubject = escapeHtml(options.subject || 'Verve Update');
  const safeToName = escapeHtml(options.toName || 'there');
  const messageParagraphs = buildMessageParagraphs(options.message);
  const currentYear = new Date().getFullYear();
  const htmlStructure = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${safeSubject}</title>
</head>
<body style="margin:0;padding:0;background:#070b14;font-family:Arial,Helvetica,sans-serif;color:#f8fafc;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeSubject}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#070b14;padding:42px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#0d1321;border:1px solid #233044;border-radius:18px;overflow:hidden;box-shadow:0 26px 70px rgba(0,0,0,0.38);">
          <tr>
            <td style="padding:0;background:#0d1321;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="height:5px;background:linear-gradient(90deg,#22d3ee,#38bdf8,#8b5cf6);font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:34px 36px 28px;background:linear-gradient(135deg,#111827 0%,#0f172a 48%,#111a2e 100%);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="display:inline-block;padding:7px 12px;border:1px solid #2b3b52;border-radius:999px;background:rgba(34,211,238,0.1);color:#67e8f9;font-size:12px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;">Verve</div>
                    <h1 style="margin:18px 0 0;color:#ffffff;font-size:30px;line-height:1.25;font-weight:800;letter-spacing:0;">${safeSubject}</h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:36px;background:#0d1321;">
              <p style="margin:0 0 20px;color:#f8fafc;font-size:17px;line-height:1.7;">Dear ${safeToName},</p>
              ${messageParagraphs}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;border-collapse:separate;">
                <tr>
                  <td style="padding:18px 20px;background:#111827;border:1px solid #26364d;border-radius:12px;">
                    <p style="margin:0;color:#aab8cf;font-size:14px;line-height:1.7;">This is an official communication from Verve. Please keep this email for your reference.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 36px;background:#09101d;border-top:1px solid #1f2c3f;text-align:center;">
              <p style="margin:0 0 6px;color:#f8fafc;font-size:14px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">VERVE</p>
              <p style="margin:0;color:#7f8da3;font-size:12px;line-height:1.6;">&copy; ${currentYear} VERVE &middot; All rights reserved</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await sendActualMail({ ...options, htmlStructure });
};
