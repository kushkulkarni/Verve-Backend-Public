// const nodemailer = require('nodemailer');
const { Resend } = require('resend');

// const transporter = nodemailer.createTransport({
//   service: 'gmail',
//   auth: {
//     user: process.env.EMAIL_USERNAME,
//     pass: process.env.EMAIL_PASSWORD,
//   },
// });

const resend = new Resend(process.env.RESEND_API_KEY);

const sendActualMail = async ({ to, subject, html }) => {
  try {
    console.log('Sending email to:', to);
    const response = await resend.emails.send({
      from: `"Verve" <noreply@${process.env.EMAIL_USERNAME}>`,
      // from: `"Verve" <onboarding@resend.dev>`,
      to,
      subject,
      html,
    });

    return {
      success: true,
      to,
      messageId: response.data?.id,
    };
  } catch (error) {
    console.log(error);
    return {
      success: false,
      to,
      error: error.message,
    };
  }
};

module.exports = sendActualMail;
