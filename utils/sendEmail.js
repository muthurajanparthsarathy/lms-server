// const sgMail = require("@sendgrid/mail");
// require("dotenv").config();
// sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// const sendEmail = async (receiverEmail, emailSubject, emailBody) => {
//   try {
//     const msg = {
//       to: receiverEmail,
//       from: process.env.FORM_EMAIL,
//       subject: emailSubject,
//       html: emailBody,
//     };

//     await sgMail.send(msg);
//     console.log("Email sent successfully");
//     return true;
//   } catch (error) {
//     console.error("Error sending email:", error);

//     if (error.response) {
//       console.error(error.response.body);
//     }

//     return false;
//   }
// };

// module.exports = { sendEmail };
// utils/sendEmail.js
//
// ONE mail entry point for the whole server. Every caller — Add User's welcome
// mail, Bulk Upload, the activate/deactivate notices — calls `sendEmail()` and
// reads `{ success, error }` back, so the transport lives here alone and no
// controller has to know what it is.
//
// Transport: Resend (https://resend.com), and ONLY Resend. There is no SMTP
// fallback on purpose — a fallback that silently re-sends from a different
// address is how a "delivered" log line stops meaning the mail actually left,
// and the Gmail App Password this used to fall back to had been dead for a
// while without anybody noticing.
//
// SENDER: `from` must be an address on a domain VERIFIED at resend.com/domains
// (currently smartcliff.in). Resend rejects any other `from` with a 403, which
// this returns as { success: false } — it never throws at the caller.
const validator = require("validator");
require("dotenv").config();
const { Resend } = require("resend");

const RESEND_API_KEY = process.env.RESENDMAIL_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM_EMAIL;

// Built once at module load. `null` when no key is configured, which the send
// path reports as a failure rather than pretending the mail went out.
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// Both of these are fatal to sending, and both are silent at runtime unless
// something says so at boot — the whole failure mode is mail that looks fine
// in the UI and never arrives.
if (!resend) {
  console.error(
    "[mail] RESENDMAIL_API_KEY is not set. No email can be sent; every " +
    "sendEmail() call will return { success: false }."
  );
} else if (!RESEND_FROM) {
  console.error(
    "[mail] RESEND_FROM_EMAIL is not set. Resend requires a `from` on a " +
    "verified domain, so every send will be rejected with a 403. Set it to an " +
    'address on your verified domain, e.g. "SmartCliff <no-reply@smartcliff.in>".'
  );
}

// Resend's API allows 2 requests/second and answers the third with
// `rate_limit_exceeded`. Bulk Upload sends one mail per user in a tight
// sequential loop, which walks straight into that and would report a run of
// perfectly valid addresses as "email failed". Spacing calls out by
// RESEND_MIN_GAP_MS keeps the whole loop under the limit; single sends (Add
// User) never wait, because the gate only holds when the PREVIOUS call was
// less than a gap ago.
const RESEND_MIN_GAP_MS = 550;
let lastResendAt = 0;
const throttleResend = async () => {
  const wait = lastResendAt + RESEND_MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastResendAt = Date.now();
};

// Recipients arrive as a single string from some callers and an array from
// others; Resend wants a clean, de-duplicated list either way.
const toList = (value) =>
  [...new Set(
    (Array.isArray(value) ? value : [value])
      .filter(Boolean)
      .map((v) => String(v).trim())
      .filter(Boolean)
  )];

const sendEmail = async (...args) => {
  try {
    let receiverEmails, emailSubject, emailBody, ccEmails;

    // Handle both object and parameter formats
    if (args.length === 1 && typeof args[0] === 'object') {
      // Object format — Add User, Bulk Upload, approvals, invitations. Extra
      // keys those callers pass (fromEmail, institutionId, users, sendType)
      // are accepted and ignored, as they always were.
      const emailData = args[0];
      receiverEmails = emailData.receiverEmails;
      emailSubject = emailData.subject || emailData.emailSubject;
      emailBody = emailData.body || emailData.emailBody;
      ccEmails = emailData.ccEmails || [];
    } else {
      // Parameter format — (to, subject, html, cc)
      [receiverEmails, emailSubject, emailBody, ccEmails = []] = args;
    }

    if (!resend) {
      return { success: false, error: "Email is not configured (RESENDMAIL_API_KEY missing)" };
    }

    // Validate receiverEmails
    const to = toList(receiverEmails);
    if (to.length === 0) {
      console.error("Error: No recipients defined");
      return {
        success: false,
        error: "No recipients defined"
      };
    }

    const cc = toList(ccEmails);

    await throttleResend();
    const { data, error } = await resend.emails.send({
      from: RESEND_FROM,
      to,
      ...(cc.length ? { cc } : {}),
      subject: emailSubject,
      html: emailBody,
    });

    // The SDK RESOLVES on an API error rather than throwing, so an unchecked
    // call would report success for a mail Resend never accepted.
    if (error) {
      console.error("Resend rejected the email:", error);
      return {
        success: false,
        error: error.message || error.name || "Resend rejected the email",
      };
    }

    console.log("Email sent successfully to:", to.join(", "), `(resend id ${data?.id})`);
    return { success: true, message: "Email sent successfully", id: data?.id };
  } catch (error) {
    console.error("Error sending email:", error);
    return {
      success: false,
      error: error.message || "Failed to send email"
    };
  }
};

// Email validation function
const isValidEmail = (email) => {
  return validator.isEmail(email);
};

module.exports = { 
  sendEmail, 
  isValidEmail
};

// const nodemailer = require("nodemailer");
// const NotificationCount = require("../models/NotificationCountModal");
// require("dotenv").config();
// const Institution = require("../models/InstitutionModal");

// class EmailService {
//   constructor() {
//     this.transporter = nodemailer.createTransport({
//       service: "gmail",
//       auth: {
//         user: process.env.NODEMAILER_FORM_EMAIL,
//         pass: process.env.NODEMAILER_FORM_EMAIL_PASSWORD,
//       },
//     });

//     console.log('EmailService initialized with:', process.env.NODEMAILER_FORM_EMAIL);

//  this.verifyTransporter().then(isVerified => {
//       console.log('Email transporter verified:', isVerified);
//     }).catch(err => {
//       console.error('Email transporter verification failed:', err);
//     });
//   }
//   async verifyTransporter() {
//     try {
//       const isVerified = await this.transporter.verify();
//       console.log('Transporter verified successfully');
//       return isVerified;
//     } catch (error) {
//       console.error("❌ Email transporter configuration error:", error.message);
//       return false;
//     }
//   }

//   isValidEmail(email) {
//     if (!email || typeof email !== 'string') return false;
//     const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
//     return emailRegex.test(email.trim());
//   }

//   prepareMailOptions(fromEmail, toEmail, ccEmails, subject, body, attachment) {
//     return {
//       from: fromEmail,
//       to: toEmail,
//       cc: ccEmails,
//       subject: subject,
//       html: body,
//       attachments: attachment
//         ? [
//             {
//               filename: attachment.filename,
//               path: attachment.path,
//             },
//           ]
//         : [],
//     };
//   }

// async updateNotificationCount(institutionId, successCount, failureCount, users, date, sendType) {
//   try {      
//     const update = {};
    
//     const mappedUsers = users.map((user) => ({
//       userId: {
//         email: user?.email || "",
//         firstName: user.firstName || "",
//         lastName: user.lastName || "",
//         phone: user.phone || "",
//         role: user.roleName || user.role || "",
//       },
//       sendDate: date,
//       sendType: sendType || "BULK_USER_CREATION",
//     }));

//     if (successCount > 0) {
//       update.$inc = { "successfulNotifications.mailNotificationCount": successCount };
//       update.$set = { "successfulNotifications.sendDate": date };
//       update.$push = {
//         "successfulNotifications.mailUsers": {
//           $each: mappedUsers
//         },
//       };
//     }

//     if (failureCount > 0) {
//       update.$inc = {
//         ...update.$inc,
//         "failedNotifications.mailNotificationCount": failureCount,
//       };
//       update.$set = {
//         ...update.$set,
//         "failedNotifications.sendDate": date,
//       };
//       update.$push = {
//         ...update.$push,
//         "failedNotifications.mailUsers": {
//           $each: mappedUsers
//         },
//       };
//     }

//     await NotificationCount.findOneAndUpdate(
//       { institution: institutionId },
//       update,
//       { 
//         upsert: true, 
//         new: true, 
//         setDefaultsOnInsert: true,
//         runValidators: true 
//       }
//     );
    
//   } catch (error) {
//     console.error("❌ Error updating notification count:", error.message);
//     console.error("Error details:", error);
//   }
// }

//   initializeEmailDetails(institution) {
//     if (!institution.emailDetails) {
//       institution.emailDetails = {
//         recharged: 0,
//         remaining: 0,
//         used: {
//           bulkUpload: 0,
//           individual: 0
//         }
//       };
//     }

//     if (!institution.emailDetails.used) {
//       institution.emailDetails.used = {
//         bulkUpload: 0,
//         individual: 0
//       };
//     }

//     if (typeof institution.emailDetails.used.bulkUpload !== 'number') {
//       institution.emailDetails.used.bulkUpload = 0;
//     }

//     if (typeof institution.emailDetails.used.individual !== 'number') {
//       institution.emailDetails.used.individual = 0;
//     }

//     if (typeof institution.emailDetails.recharged !== 'number') {
//       institution.emailDetails.recharged = 0;
//     }

//     if (typeof institution.emailDetails.remaining !== 'number') {
//       institution.emailDetails.remaining = Math.max(
//         0,
//         institution.emailDetails.recharged - 
//         (institution.emailDetails.used.bulkUpload + institution.emailDetails.used.individual)
//       );
//     }

//     if (!institution.alerts) {
//       institution.alerts = {};
//     }

//     if (typeof institution.alerts.emailLowBalance !== 'boolean') {
//       institution.alerts.emailLowBalance = institution.emailDetails.remaining < 50;
//     }

//     return institution;
//   }

//   async sendEmail({
//     fromEmail,
//     receiverEmails,
//     ccEmails = [],
//     subject,
//     body,
//     institutionId,
//     users = [],
//     sendType = "GENERAL_NOTIFICATION",
//     attachment
//   }) {
//     const sendDate = new Date();

//     // Validate fromEmail
//     if (!fromEmail || !this.isValidEmail(fromEmail)) {
//       console.error("❌ Invalid fromEmail:", fromEmail);
//       return {
//         success: false,
//         successfulEmails: [],
//         failedEmails: [],
//         error: "Invalid sender email address"
//       };
//     }

//     // Normalize receiver emails to array
//     const recipients = Array.isArray(receiverEmails) ? receiverEmails : [receiverEmails];
//     const successfulEmails = [];
//     const failedEmails = [];

//     try {
//       // Validate email addresses
//       const validRecipients = recipients.filter((email) => {
//         if (this.isValidEmail(email)) return true;
//         failedEmails.push(email);
//         console.warn(`❌ Invalid email format: ${email}`);
//         return false;
//       });

//       if (validRecipients.length === 0) {
//         console.error("❌ No valid email recipients found");
//         return {
//           success: false,
//           successfulEmails: [],
//           failedEmails: failedEmails,
//           error: "No valid email recipients found"
//         };
//       }

//       // Send emails
//       const emailResults = await Promise.allSettled(
//         validRecipients.map((email) => {
//           const mailOptions = this.prepareMailOptions(
//             fromEmail,
//             email,
//             ccEmails,
//             subject,
//             body,
//             attachment
//           );
//           return this.transporter.sendMail(mailOptions);
//         })
//       );

//       // Process results
//       emailResults.forEach((result, index) => {
//         const email = validRecipients[index];
//         if (result.status === "fulfilled") {
//           successfulEmails.push(email);
//           console.log(`✅ Email sent successfully to: ${email}`);
//         } else {
//           failedEmails.push(email);
//           console.error(`❌ Failed to send email to: ${email}`, result.reason);
//         }
//       });

//       if (institutionId) {
//         try {
//           const successfulUsers = users.filter((u) => u && successfulEmails.includes(u.email));
//           const failedUsers = users.filter((u) => u && failedEmails.includes(u.email));

//           await this.updateNotificationCount(
//             institutionId,
//             successfulEmails.length,
//             failedEmails.length,
//             [...successfulUsers, ...failedUsers],
//             sendDate,
//             sendType
//           );

//           // Update institution email usage
//           if (successfulEmails.length > 0) {
//             const institution = await Institution.findById(institutionId);
//             if (institution) {
//               this.initializeEmailDetails(institution);
//               institution.emailDetails.used.individual += successfulEmails.length;
//               const totalUsed = institution.emailDetails.used.bulkUpload + institution.emailDetails.used.individual;
//               institution.emailDetails.remaining = Math.max(0, institution.emailDetails.recharged - totalUsed);
//               institution.alerts.emailLowBalance = institution.emailDetails.remaining < 50;
//               await institution.save();
//             }
//           }
//         } catch (dbError) {
//           console.error("❌ Error updating database records:", dbError.message);
//           // Don't fail the email process
//         }
//       }
      
//       return { 
//         success: failedEmails.length === 0, 
//         successfulEmails, 
//         failedEmails,
//         totalSent: successfulEmails.length,
//         totalFailed: failedEmails.length
//       };
//     } catch (error) {
//       console.error("❌ Error during email sending process:", error);
//       return {
//         success: false,
//         successfulEmails: [],
//         failedEmails: recipients,
//         error: error.message,
//       };
//     }
//   }
// }

// module.exports = EmailService;
