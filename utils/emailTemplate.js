exports.generalTemplate = ({ subject, name, content }) => {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
</head>

<body style="margin:0;padding:0;background:#f0f3f8;font-family:Arial,Helvetica,sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;">
<tr>
<td align="center">

<!-- Main Container -->
<table width="620" cellpadding="0" cellspacing="0"
style="background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 10px 25px rgba(0,0,0,0.12);">

<!-- Header -->
<tr>
<td style="background:linear-gradient(135deg,#3a5a68,#203a43,#2c5364);
padding:30px 20px;text-align:center;color:#ffffff;">

  <h1 style="margin:0;font-size:24px;font-weight:600;letter-spacing:0.4px;">
    ${subject}
  </h1>

</td>
</tr>

<!-- Body -->
<tr>
<td style="padding:38px 32px;color:#2b2b2b;font-size:15px;line-height:1.8;">

  <p style="margin:0 0 14px 0;">
    Dear <strong>${name || 'Applicant'}</strong>,
  </p>

  <p style="margin:0 0 22px 0;">
    ${content}
  </p>

  <!-- Divider -->
  <div style="height:1px;background:#e6e6e6;margin:30px 0;"></div>

  <p style="margin:0;">
    Regards,<br>
    <strong>Verve</strong>
  </p>

</td>
</tr>

<!-- Footer -->
<tr>
<td style="background:linear-gradient(135deg,#3a5a68,#203a43,#2c5364);
padding:16px;text-align:center;font-size:12px;color:#ffffff;">

  © VERVE · All rights reserved

</td>
</tr>

</table>

</td>
</tr>
</table>

</body>
</html>`;
};
