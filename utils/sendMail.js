const sendActualMail = require('./email');
const { generalTemplate } = require('./emailTemplate');

exports.sendMail = async (options) => {
  try {
    // Normalize (single or multiple)
    const recipient = options.recipient;

    // const mailPromises = recipients.map((user) => {
    const html = generalTemplate({
      subject: options.subject,
      name: recipient.name ?? 'User',
      content: options.message,
    });

    const result = await sendActualMail({
      to: recipient.email ?? recipient,
      subject: options.subject,
      html,
    });
    // });

    // const results = await Promise.all(mailPromises);

    return {
      //   total: results.length,
      //   success: results.filter((r) => r.success).length,
      //   failed: results.filter((r) => !r.success).length,
      details: result,
    };
  } catch (error) {
    throw new Error('Email sending failed: ', error.message);
  }
};
