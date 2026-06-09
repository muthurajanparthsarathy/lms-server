const User = require("../models/UserModel");
const ActivityLog = require("../models/ActivityLog");
const Otp = require("../models/OTPModel");
const { createSecretToken } = require("../config/secretToken");
const config = require("config");
const BASE_URL = config.get("BASE_URL");
const mongoose = require("mongoose");
const Role = require("../models/RoleModel");

const bcrypt = require("bcryptjs");
const emailUtil = require("../utils/sendEmail");
const EmailService = require("../utils/sendEmail");
const jwt = require("jsonwebtoken");
const JWT_TOKEN_KEY = config.get("JWT_TOKEN_KEY");
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");
const tokenModal = require("../models/tokenModal");
const xlsx = require("xlsx");

const { createClient } = require("@supabase/supabase-js");
const BulkSendMail = require("../models/BulkSendMailCount");
const InstitutionModal = require("../models/InstitutionModal");
const roleModel = require("../models/RoleModel");
const supabaseKey = process.env.SUPABASE_KEY;
const supabaseUrl = process.env.SUPABASE_URL;

const supabase = createClient(supabaseUrl, supabaseKey);

const getDefaultPermissions = (roleName) => {
  // Student permissions
  if (roleName === 'student') {
    return [
      {
        permissionName: "Student Dashboard",
        permissionKey: "studentdashboard",
        permissionFunctionality: [
          "view_courses",
          "view_grades",
          "submit_assignments"
        ],
        icon: "Home",
        color: "green",
        description: "Student Dashboard Access",
        isActive: true,
        order: 0
      }
    ];
  }
  
  // Admin permissions
  if (roleName === 'admin') {
    return [
      {
        permissionName: "Admin Dashboard",
        permissionKey: "admindashboard",
        permissionFunctionality: [
          "view_users",
          "add_users",
          "edit_users",
          "delete_users"
        ],
        icon: "Home",
        color: "green",
        description: "Admin Dashboard Management",
        isActive: true,
        order: 0
      }
    ];
  }
  
  // Staff permissions - This will apply to ALL other roles (faculty, coordinator, manager, etc.)
  // Any role that is not 'student' or 'admin' will get these permissions
  return [
    {
      permissionName: "Staff Dashboard",
      permissionKey: "dashboard",
      permissionFunctionality: [
        "view_users",
        "add_users",
        "edit_users",
        "delete_users"
      ],
      icon: "Home",
      color: "green",
      description: "Staff Dashboard Management",
      isActive: true,
      order: 0
    }
  ];
};

// Updated addUser function
exports.Addusers = async (req, res) => {
  try {
    const {
      email,
      firstName,
      lastName,
      phone,
      role, // This is the role ID
      gender,
      password,
      status,
      course,
      degree,
      department, 
      year, 
      semester,
      batch,
    } = req.body;
    
    if (!email || !firstName || !lastName || !password) {
      return res.status(400).json({
        message: [{ key: "error", value: "Missing required fields" }],
      });
    }
    
    // Validate email format
    if (!emailUtil.isValidEmail(email)) {
      return res.status(400).json({
        message: [{ key: "error", value: "Invalid email format" }],
      });
    }

    const existingEmployee = await User.findOne({ email });
    if (existingEmployee) {
      return res.status(403).json({
        message: [{ key: "error", value: "User already exists" }],
      });
    }

    // Get the role details to determine default permissions
    const roleDetails = await Role.findById(role);
    if (!roleDetails) {
      return res.status(400).json({
        message: [{ key: "error", value: "Invalid role selected" }],
      });
    }

    // Get role name from the role details (use renameRole or originalRole)
    const roleName = roleDetails.renameRole ? roleDetails.renameRole.toLowerCase() : 
                     roleDetails.originalRole ? roleDetails.originalRole.toLowerCase() : 
                     'staff'; // Default to staff if role name is not found
    
    // Get default permissions based on role
    // For student and admin, specific permissions will be returned
    // For any other role (faculty, coordinator, manager, etc.), staff permissions will be returned
    const defaultPermissions = getDefaultPermissions(roleName);

    let imageUrl;
    const imageFile = req.files?.profile;

    if (imageFile) {
      const uniqueFileName = `${Date.now()}_${imageFile.name}`;
      const { data, error } = await supabase.storage
        .from("smartlms")
        .upload(`users/profile/${uniqueFileName}`, imageFile.data);

      if (error) {
        console.error("Error uploading image to Supabase:", error);
        return res.status(500).json({
          message: [
            { key: "error", value: "Error uploading image to Supabase" },
          ],
        });
      }
      imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/smartlms/users/profile/${uniqueFileName}`;
    } else {
      const currentDate = new Date();
      const defaultFileName = `default_profile_image_${currentDate.getTime()}.jpg`;
      const { data, error } = await supabase.storage
        .from("smartlms")
        .copy(
          "users/profile/default_profile_image.jpg",
          `users/profile/${defaultFileName}`
        );

      if (error) {
        console.error("Error copying default image in Supabase:", error);
        return res.status(500).json({
          message: [
            { key: "error", value: "Error setting up default profile image" },
          ],
        });
      }
      imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/smartlms/users/profile/${defaultFileName}`;
    }

    const newUser = await User.create({
      email,
      firstName,
      lastName,
      phone,
      gender,
      password,
      profile: imageUrl,
      role: role,
      course,
      batch,
      degree,
      department, 
      year, 
      semester,
      status: status || "active",
      permissions: defaultPermissions, // Assign default permissions
      institution: req.user.institution,
      createdBy: req.user.email,
    });

    const token = createSecretToken(newUser._id);

    const emailSubject = `Welcome to smartlms LMS - Your Account Details`;
    const emailBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Welcome to the smartlms Dashboard</h2>
        <p>You have been successfully added as a user to our system.</p>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
          <h3 style="color: #495057;">Your Account Details:</h3>
          <p><strong>Name:</strong> ${firstName} ${lastName}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Temporary Password:</strong> ${password}</p>
          <p><strong>Role:</strong> ${roleDetails.renameRole || roleDetails.originalRole}</p>
        </div>
        
        <p><strong>Important:</strong> Please change your password after your first login for security purposes.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${process.env.BASE_URL || "http://localhost:3000"}/login" 
             style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
             Login to Your Account
          </a>
        </div>
        
        <p style="color: #6c757d; font-size: 14px;">
          If you have any questions, please contact your administrator.
        </p>
      </div>
    `;

    // Send email
    const emailResult = await emailUtil.sendEmail({
      receiverEmails: email,
      subject: emailSubject,
      body: emailBody,
    });

    if (emailResult.success) {
      res.status(201).json({
        message: [{ key: "success", value: "User registered successfully with welcome email" }],
        user: {
          _id: newUser._id,
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          institution: newUser.institution,
          permissions: newUser.permissions,
          profile: newUser.profile,
          role: newUser.role,
        },
        token: token,
      });
    } else {
      res.status(201).json({
        message: [
          { key: "success", value: "User registered successfully" },
          {
            key: "warning",
            value: `Welcome email failed to send: ${emailResult.error || 'Unknown error'}`,
          },
        ],
        user: {
          _id: newUser._id,
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          institution: newUser.institution,
          permissions: newUser.permissions,
          profile: newUser.profile,
          role: newUser.role,
        },
        token: token,
      });
    }
  } catch (error) {
    console.error("Error creating user:", error);

    if (error.name === "ValidationError") {
      const errors = Object.keys(error.errors).map((key) => ({
        key,
        value: error.errors[key].message,
      }));
      return res.status(400).json({ message: errors });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        message: [
          { key: "error", value: "User with this email already exists" },
        ],
      });
    }

    res.status(500).json({
      message: [
        { key: "error", value: "Internal server error while creating user" },
      ],
    });
  }
};


module.exports.UserSignIn = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: [{ key: "error", value: "All fields are required" }],
      });
    }

    const user = await User.findOne({ email }).populate('institution').populate('role'); // Make sure to populate role

    if (!user) {
      return res.status(400).json({
        message: [{ key: "error", value: "Email is invalid" }],
      });
    }

    if (user.status !== 'active') {
      let errorMessage = "Account is not active";
      
      if (user.status === 'inactive') {
        errorMessage = "Your account is inactive. Please contact administrator";
      } else if (user.status === 'suspended') {
        errorMessage = "Your account has been suspended. Please contact administrator";
      }
      
      return res.status(403).json({
        message: [{ key: "error", value: errorMessage }],
      });
    }

    const auth = await bcrypt.compare(password, user.password);
    if (!auth) {
      return res.status(400).json({
        message: [{ key: "error", value: "Password is incorrect" }],
      });
    }

    const isFirstTimeLogin = user.firstTimeLoginDone;

    if (isFirstTimeLogin) {
      await User.updateOne({ _id: user._id }, { firstTimeLoginDone: false });
    }

    const token = createSecretToken(user._id, "2d");

    const newToken = new tokenModal({
      token: token,
    });
    await newToken.save();

    // Fire-and-forget login activity log — never blocks the login response
    const clientInfo = req.body.clientInfo || {};
    const rawIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket?.remoteAddress || req.ip || '';
    // Normalise IPv4-mapped IPv6 loopback (::1, ::ffff:127.0.0.1) to a clean value
    const resolvedIp = /^(::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/.test(rawIp) ? 'localhost' : rawIp;
    ActivityLog.create({
      userId: user._id,
      userName: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
      userEmail: user.email,
      userRole: user.role?.originalRole || user.role?.renameRole || '',
      action: 'login',
      details: {
        // Prefer the real public IP the client resolved; fall back to the
        // server-derived IP (which is 'localhost' in local development).
        ipAddress: clientInfo.ipAddress || resolvedIp,
        location:  clientInfo.location  || null,
        device:    clientInfo.device    || null,
        browser:   clientInfo.browser   || null,
        os:        clientInfo.os        || null,
        userAgent: clientInfo.userAgent || null,
      },
    }).catch(() => {});

    const sanitizedUser = {
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      firstTimeLoginDone: isFirstTimeLogin,
      institution: user.institution._id,
      status: user.status,
      permissions:user.permissions,
    };

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
      maxAge: 2 * 24 * 60 * 60 * 1000,
    });

    return res.status(201).json({
      message: [
        { key: "success", value: `${user.role.originalRole} logged in successfully` },
      ],
      user: sanitizedUser,
      token: token,
      institution: user.institution._id,
      institutionName: user.institution.inst_name,
            basedOn: user.institution.basedOn,

      userId: user._id,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: [{ key: "error", value: "Internal Server Error" }],
    });
  }
};

module.exports.verifyToken = async (req, res, next) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1];
    
    if (!token) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const decoded = jwt.verify(token, JWT_TOKEN_KEY);

    const user = await User.findOne({ _id: decoded.id }).populate('role');

    if (!user) {
      return res.status(401).json({ message: "Invalid token" });
    }

    req.user = user;
    req.token = token;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

module.exports.UserLogout = async (req, res) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        message: [{ key: "error", value: "No token provided" }],
      });
    }

    const user = await User.findOneAndUpdate(
      { _id: req.user._id },
      { $pull: { tokens: { token: token } } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        message: [{ key: "error", value: "User not found" }],
      });
    }

    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
    });

    return res.status(200).json({
      message: [{ key: "success", value: "Logged out successfully" }],
    });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({
      message: [{ key: "error", value: "Internal Server Error" }],
    });
  }
};

module.exports.UserLogoutAll = async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { _id: req.user._id },
      { $set: { tokens: [] } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({
        message: [{ key: "error", value: "User not found" }],
      });
    }

    // Clear the cookie
    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "none",
    });

    return res.status(200).json({
      message: [
        { key: "success", value: "Logged out from all devices successfully" },
      ],
    });
  } catch (error) {
    console.error("Logout all error:", error);
    return res.status(500).json({
      message: [{ key: "error", value: "Internal Server Error" }],
    });
  }
};

module.exports.UserVerify = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        message: [{ key: "error", value: "User not found" }],
      });
    }

    const sanitizedUser = {
      id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      address: user.address,
      profile: user.profile,
      role: user.role.originalRole,
      designation: user.designation,
      institution: user.institution,
      permission: user.permission,
    };

    return res.status(200).json({
      user: sanitizedUser,
    });
  } catch (error) {
    return res.status(500).json({
      message: [
        { key: "error", value: "Internal Server Error", detail: error.message },
      ],
    });
  }
};

exports.getUserAccess = async (req, res) => {
  try {
    const { instutionId } = req.params; 
    
    let filter = {};
    if (instutionId && instutionId !== 'all') {
      filter.institution = instutionId;
    }
    
    const Users = await User.find(filter).populate('institution').populate('role');
    
    if (!Users || Users.length === 0) {
      const message = instutionId && instutionId !== 'all'
        ? `No users found for institution ID: ${instutionId}`
        : "No users found";
      console.error(message);
      return res.status(404).json({ message });
    }
    
    const successMessage = instutionId && instutionId !== 'all'
      ? `Users retrieved for institution ID: ${instutionId}`
      : "All users retrieved successfully";
    
    res.status(200).json({
      message: [{ key: "success", value: successMessage }],
      Users: Users,
      totalCount: Users.length,
    });
  } catch (error) {
    console.error("Error in getUserAccess:", error);
    res.status(500).json({ 
      message: [{ key: "error", value: "Internal server error" }] 
    });
  }
};
exports.getUserAccessById = async (req, res) => {
  const { id } = req.params;

  try {
    const user = await User.findById(id);
    if (!user) {
      return res
        .status(404)
        .json({ message: [{ key: "error", value: "User not found" }] });
    }

    res.status(200).json({
      message: [
        { key: "success", value: "User section Id based get the data" },
      ],
      user: user,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: [{ key: "error", value: "Internal server error" }] });
  }
};

exports.UpdateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      email,
      firstName,
      lastName,
      phone,
      role, 
      gender,
      permission,
      status,
      batch,
      degree,
      department, year, semester,
    } = req.body;

    const existingUser = await User.findById(userId);
    if (!existingUser) {
      return res.status(404).json({
        message: [{ key: "error", value: "User not found" }],
      });
    }

    if (email && email !== existingUser.email) {
      const emailExists = await User.findOne({ email, _id: { $ne: userId } });
      if (emailExists) {
        return res.status(403).json({
          message: [{ key: "error", value: "Email already exists" }],
        });
      }
    }

    let imageUrl;
    const imageFile = req.files?.profile;

    if (imageFile) {
      if (
        existingUser.profile &&
        !existingUser.profile.includes("default_profile_image")
      ) {
        try {
          const oldImagePath = existingUser.profile.split("/").pop();
          const { error: deleteError } = await supabase.storage
            .from("smartlms")
            .remove([`users/profile/${oldImagePath}`]);

          if (deleteError) {
            console.error("Error deleting old image:", deleteError);
          }
        } catch (deleteErr) {
          console.error("Error extracting old image path:", deleteErr);
        }
      }

      const uniqueFileName = `${Date.now()}_${imageFile.name}`;
      const { data, error } = await supabase.storage
        .from("smartlms")
        .upload(`users/profile/${uniqueFileName}`, imageFile.data);

      if (error) {
        console.error("Error uploading image to Supabase:", error);
        return res.status(500).json({
          message: [
            { key: "error", value: "Error uploading image to Supabase" },
          ],
        });
      }
      imageUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/smartlms/users/profile/${uniqueFileName}`;
    }

    const updateData = {
      ...(email && { email }),
      ...(firstName && { firstName }),
      ...(lastName && { lastName }),
      ...(phone && { phone }),
      ...(gender && { gender }),
      ...(batch && { batch }),
      ...(degree && { degree }),
      ...(department && { department }),
      ...(year && { year }),
      ...(semester && { semester }),
      ...(role && { role }),
      ...(status && { status }),
      ...(permission && { permission }),
      ...(imageUrl && { profile: imageUrl }),
      updatedBy: req.user.email,
      updatedAt: new Date(),
    };

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updatedUser) {
      return res.status(404).json({
        message: [{ key: "error", value: "User not found" }],
      });
    }

    res.status(200).json({
      message: [{ key: "success", value: "User updated successfully" }],
      user: {
        _id: updatedUser._id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        phone: updatedUser.phone,
        gender: updatedUser.gender,
        role: updatedUser.role,
        institution: updatedUser.institution,
        permission: updatedUser.permission,
        profile: updatedUser.profile,
        updatedAt: updatedUser.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error updating user:", error);

    if (error.name === "ValidationError") {
      const errors = Object.keys(error.errors).map((key) => ({
        key,
        value: error.errors[key].message,
      }));
      return res.status(400).json({ message: errors });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        message: [
          { key: "error", value: "User with this email already exists" },
        ],
      });
    }

    res.status(500).json({
      message: [
        { key: "error", value: "Internal server error while updating user" },
      ],
    });
  }
};

exports.DeleteUser = async (req, res) => {
  try {
    const { userId } = req.params;

    const existingUser = await User.findById(userId);
    if (!existingUser) {
      return res.status(404).json({
        message: [{ key: "error", value: "User not found" }],
      });
    }

    if (existingUser.profile) {
      try {
        const imageUrlParts = existingUser.profile.split("/");
        const imageName = imageUrlParts[imageUrlParts.length - 1];

        const { error: removeError } = await supabase.storage
          .from("smartlms")
          .remove([`users/profile/${imageName}`]);

        if (removeError) {
          console.error("Error removing image from Supabase:", removeError);
          return res.status(500).json({
            message: [
              {
                key: "error",
                value: "Error removing image from Supabase storage",
              },
            ],
          });
        }
      } catch (error) {
        console.error("Error in removing image:", error);
        return res.status(500).json({
          message: [
            {
              key: "error",
              value: "Error removing image from Supabase storage",
            },
          ],
        });
      }
    }
    const deletedUser = await User.findByIdAndDelete(userId);

    if (!deletedUser) {
      return res.status(404).json({
        message: [{ key: "error", value: "User not found" }],
      });
    }

    res.status(200).json({
      message: [{ key: "success", value: "User deleted successfully" }],
      deletedUser: {
        _id: deletedUser._id,
        email: deletedUser.email,
        firstName: deletedUser.firstName,
        lastName: deletedUser.lastName,
      },
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({
      message: [
        { key: "error", value: "Internal server error while deleting user" },
      ],
    });
  }
};


exports.toggleUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;

    if (!userId) {
      return res.status(400).json({
        message: [{ key: "error", value: "User ID is required" }],
      });
    }

    if (status && !["active", "inactive"].includes(status)) {
      return res.status(400).json({
        message: [{ key: "error", value: "Status must be either 'active' or 'inactive'" }],
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: [{ key: "error", value: "User not found" }],
      });
    }

    const newStatus = status || (user.status === "active" ? "inactive" : "active");
    
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        status: newStatus,
        updatedAt: new Date(),
        updatedBy: req.user.email,
      },
      { 
        new: true,
        runValidators: true
      }
    ).select("-password -tokens");

    const emailSubject = "Account Status Update - smartlms HUB";
    let emailBody;

    if (newStatus === "inactive") {
      emailBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Account Status Update</h2>
          <p>Hello ${updatedUser.firstName} ${updatedUser.lastName},</p>
          
          <div style="background-color: #fff3cd; padding: 20px; border-left: 4px solid #ffc107; margin: 20px 0;">
            <h3 style="color: #856404;">Account Deactivated</h3>
            <p>Your account has been temporarily deactivated. Please contact your administrator if you believe this is an error.</p>
          </div>
          
          <p style="color: #6c757d; font-size: 14px;">
            If you have any questions, please contact your administrator.
          </p>
        </div>
      `;
    } else {
      emailBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Account Status Update</h2>
          <p>Hello ${updatedUser.firstName} ${updatedUser.lastName},</p>
          
          <div style="background-color: #d4edda; padding: 20px; border-left: 4px solid #28a745; margin: 20px 0;">
            <h3 style="color: #155724;">Account Activated</h3>
            <p>Great news! Your account has been activated and you can now access all features of the smartlms platform.</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.BASE_URL || "http://localhost:3000"}/login" 
               style="background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
               Login to Your Account
            </a>
          </div>
          
          <p style="color: #6c757d; font-size: 14px;">
            If you have any questions, please contact your administrator.
          </p>
        </div>
      `;
    }

    emailUtil.sendEmail(updatedUser.email, emailSubject, emailBody)
      .catch(error => console.error("Failed to send status update email:", error));

    res.status(200).json({
      message: [{ 
        key: "success", 
        value: `User status updated to ${newStatus} successfully` 
      }],
      user: {
        _id: updatedUser._id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        role: updatedUser.role,
        status: updatedUser.status,
        institution: updatedUser.institution,
      },
    });

  } catch (error) {
    console.error("Error updating user status:", error);

    if (error.name === "CastError") {
      return res.status(400).json({
        message: [{ key: "error", value: "Invalid user ID format" }],
      });
    }

    res.status(500).json({
      message: [{ key: "error", value: "Internal server error while updating user status" }],
    });
  }
};

exports.bulkToggleUserStatus = async (req, res) => {
  try {
    const { userIds, status } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        message: [{ key: "error", value: "User IDs array is required" }],
      });
    }

    if (!status || !["active", "inactive"].includes(status)) {
      return res.status(400).json({
        message: [{ key: "error", value: "Status must be either 'active' or 'inactive'" }],
      });
    }

    const result = await User.updateMany(
      { _id: { $in: userIds } },
      { 
        status: status,
        updatedAt: new Date(),
        updatedBy: req.user.email
      }
    );

    const updatedUsers = await User.find(
      { _id: { $in: userIds } }
    ).select("-password -tokens");

    const emailSubject = "Account Status Update - smartlms HUB";
    
    const emailPromises = updatedUsers.map(user => {
      let emailBody;
      
      if (status === "inactive") {
        emailBody = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Account Status Update</h2>
            <p>Hello ${user.firstName} ${user.lastName},</p>
            
            <div style="background-color: #fff3cd; padding: 20px; border-left: 4px solid #ffc107; margin: 20px 0;">
              <h3 style="color: #856404;">Account Deactivated</h3>
              <p>Your account has been temporarily deactivated. Please contact your administrator if you believe this is an error.</p>
            </div>
            
            <p style="color: #6c757d; font-size: 14px;">
              If you have any questions, please contact your administrator.
            </p>
          </div>
        `;
      } else {
        emailBody = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Account Status Update</h2>
            <p>Hello ${user.firstName} ${user.lastName},</p>
            
            <div style="background-color: #d4edda; padding: 20px; border-left: 4px solid #28a745; margin: 20px 0;">
              <h3 style="color: #155724;">Account Activated</h3>
              <p>Great news! Your account has been activated and you can now access all features of the smartlms platform.</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.BASE_URL || "http://localhost:3000"}/signin" 
                 style="background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                 Login to Your Account
              </a>
            </div>
            
            <p style="color: #6c757d; font-size: 14px;">
              If you have any questions, please contact your administrator.
            </p>
          </div>
        `;
      }
      
      return emailUtil.sendEmail(user.email, emailSubject, emailBody)
        .catch(error => console.error(`Failed to send status update email to ${user.email}:`, error));
    });

    Promise.all(emailPromises)
      .catch(error => console.error("Some emails failed to send:", error));

    res.status(200).json({
      message: [{ 
        key: "success", 
        value: `${result.modifiedCount} users updated to ${status} successfully` 
      }],
      updatedCount: result.modifiedCount,
      users: updatedUsers.map(user => ({
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: user.status,
      })),
    });

  } catch (error) {
    console.error("Error bulk updating user status:", error);

    res.status(500).json({
      message: [{ key: "error", value: "Internal server error while updating users status" }],
    });
  }
};



exports.bulkUploadUsers = async (req, res) => {
  let filePath = null;

  try {
    const { notificationMethod, batch } = req.body;
    let courses = req.body.courses;
    const institutionId = req.user.institution;

    if (!institutionId) {
      return res.status(400).json({
        message: [{ key: "error", value: "Institution is required" }],
      });
    }

    if (!req.files || !req.files.file) {
      return res.status(400).json({
        message: [{ key: "error", value: "File is required" }],
      });
    }

    const institutionDoc = await InstitutionModal.findById(institutionId);
    if (!institutionDoc) {
      return res.status(404).json({
        message: [{ key: "error", value: "Institution not found" }],
      });
    }

    const file = req.files.file;
    const uniqueFileName = `${Date.now()}_${file.name}`;
    filePath = path.join(__dirname, "..", "uploads", uniqueFileName);

    // Move file to uploads directory
    await file.mv(filePath);

    // Process the Excel file
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const results = xlsx.utils.sheet_to_json(worksheet);
    if (results.length > 78) {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return res.status(400).json({
        message: [{ key: "error", value: "Cannot upload more than 70 users" }],
      });
    }

    // Handle courses - ensure it's an array
    if (courses) {
      if (typeof courses === 'string') {
        courses = [courses];
      } else if (!Array.isArray(courses)) {
        courses = [];
      }
    } else {
      courses = [];
    }

    // Validate course IDs if provided
    const validCourses = [];
    if (courses.length > 0) {
      for (const courseId of courses) {
        try {
          // Check if course exists - adjust model name as needed
          const course = await CourseStructureModal.findById(courseId);
          if (course) {
            validCourses.push(courseId);
          } else {
            console.warn(`Course not found: ${courseId}`);
          }
        } catch (error) {
          console.warn(`Invalid course ID: ${courseId}`, error);
        }
      }
    }

    const users = [];
    const existingUsers = [];
    const sentEmails = [];
    const notSentEmails = [];
    const totalEmail = [];
    const validationErrors = [];
    let creditExceeded = false;

    const existingRoles = await roleModel.find({ institution: institutionId });
    
    const findOrCreateRole = async (roleName) => {
      if (!roleName) return null;
      
      let role = existingRoles.find(r => 
        r.originalRole?.toLowerCase() === roleName.toLowerCase() ||
        r.renameRole?.toLowerCase() === roleName.toLowerCase()
      );
      
      if (role) {
        return role._id;
      }
      
      try {
        const newRole = new roleModel({
          institution: institutionId,
          originalRole: roleName,
          renameRole: roleName,
          roleValue: roleName.toLowerCase().replace(/\s+/g, '_'),
          createdBy: req.user.email || "system"
        });
        
        await newRole.save();
        existingRoles.push(newRole);
        return newRole._id;
      } catch (error) {
        console.error(`Error creating role ${roleName}:`, error);
        return null;
      }
    };

    // Process each user
    for (const userData of results) {
      const { email, firstName, lastName, phone, role, gender, password } = userData;

      if (!email) {
        validationErrors.push({
          user: userData,
          error: "Email is required"
        });
        continue;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        validationErrors.push({
          user: userData,
          error: "Invalid email format"
        });
        notSentEmails.push({ email, firstName, lastName, role });
        continue;
      }
      
      const roleId = await findOrCreateRole(role);
      
      if (!roleId) {
        validationErrors.push({
          user: userData,
          error: `Invalid role: ${role}`
        });
        notSentEmails.push({ email, firstName, lastName, role });
        continue;
      }

      totalEmail.push({ email, firstName, phone, lastName, role, gender });
      const existingUser = await User.findOne({ email, institution: institutionId });
      if (existingUser) {
        existingUsers.push({ ...userData, error: "User already exists" });
        notSentEmails.push({ email, firstName, lastName, role });
        continue;
      }

      try {
        // Prepare user data
        const userDataToSave = {
          email,
          firstName,
          lastName,
          password, 
          role: roleId, 
          phone,
          institution: institutionId, 
          createdBy: req.user.email || "system",
          gender,
        };

        // Add batch if provided
        if (batch && batch.trim()) {
          userDataToSave.batch = batch.trim();
        }

        // Add enrolled courses if provided
        if (validCourses.length > 0) {
          userDataToSave.enrolledCourses = validCourses;
        }

        const newUser = new User(userDataToSave);
        await newUser.save();
        users.push(newUser);

        // Create course enrollments if you have a separate model
        // if (validCourses.length > 0) {
        //   for (const courseId of validCourses) {
        //     await UserCourseEnrollment.create({
        //       user: newUser._id,
        //       course: courseId,
        //       institution: institutionId,
        //       enrolledBy: req.user.email || "system"
        //     });
        //   }
        // }

        const emailSubject = "Welcome to SmartLMS - Your Account Details";
        const emailBody = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Welcome to SmartLMS Dashboard</h2>
            <p>You have been successfully added as a user to our system.</p>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <h3 style="color: #495057;">Your Account Details:</h3>
              <p><strong>Name:</strong> ${firstName} ${lastName}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Role:</strong> ${role}</p>
              ${batch ? `<p><strong>Batch:</strong> ${batch}</p>` : ''}
              <p><strong>Password:</strong> ${password}</p>
            </div>
            
            <p><strong>Important:</strong> Please change your password after your first login for security purposes.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.BASE_URL || "http://localhost:3000"}/login" 
                 style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                 Login to Your Account
              </a>
            </div>
            
            <p style="color: #6c757d; font-size: 14px;">
              If you have any questions, please contact your administrator.
            </p>
          </div>
        `;

        const emailResponse = await EmailService.sendEmail({
          fromEmail: process.env.NODEMAILER_FORM_EMAIL,
          receiverEmails: email,
          subject: emailSubject,
          body: emailBody,
          institutionId: institutionId,
          users: [{ 
            email: email, 
            firstName: firstName, 
            lastName: lastName, 
            role: role, 
            phone: phone || "" 
          }],
          sendType: "BULK_USER_CREATION",
        });

        if (emailResponse.success) {
          sentEmails.push({ email, firstName, lastName, role });
          console.log(`✅ Email sent successfully to: ${email}`);
        } else {
          notSentEmails.push({ email, firstName, lastName, role });
          console.log(`❌ Email failed for: ${email}`, emailResponse.error);
          if (emailResponse.creditExceeded) creditExceeded = true;
        }
      } catch (userError) {
        console.error("Error creating user:", userError);
        validationErrors.push({
          user: userData,
          error: userError.message || "Unknown processing error",
        });
        notSentEmails.push({ email, firstName, lastName, role });
      }
    }

    // Save bulk upload data
    let bulkSendMail = await BulkSendMail.findOne({ institution: institutionId });
    if (!bulkSendMail) {
      bulkSendMail = new BulkSendMail({
        institution: institutionId,
        emailBulkUploadCounts: [],
        overAllCount: {
          overAllEmailSuccessCount: 0,
          overAllEmailFailedCount: 0,
        },
      });
    }

    bulkSendMail.overAllCount.overAllEmailSuccessCount += sentEmails.length;
    bulkSendMail.overAllCount.overAllEmailFailedCount += notSentEmails.length;

    const uploadRecord = {
      totalEmail,
      notSendmail: notSentEmails,
      sendmail: sentEmails,
      fileName: uniqueFileName,
      sendBy: req.user.email || "system",
    };

    // Add batch and courses to record if provided
    if (batch && batch.trim()) {
      uploadRecord.batch = batch.trim();
    }
    if (validCourses.length > 0) {
      uploadRecord.courses = validCourses;
      uploadRecord.courseCount = validCourses.length;
    }

    bulkSendMail.emailBulkUploadCounts.push(uploadRecord);

    // Update institution email details
    if (!institutionDoc.emailDetails) {
      institutionDoc.emailDetails = {
        recharged: 0,
        remaining: 0,
        used: { bulkUpload: 0, individual: 0 }
      };
    }
    if (!institutionDoc.emailDetails.used) {
      institutionDoc.emailDetails.used = { bulkUpload: 0, individual: 0 };
    }

    institutionDoc.emailDetails.used.bulkUpload += sentEmails.length;
    const totalUsed =
      (institutionDoc.emailDetails.used.bulkUpload || 0) +
      (institutionDoc.emailDetails.used.individual || 0);

    institutionDoc.emailDetails.remaining = Math.max(
      0,
      (institutionDoc.emailDetails.recharged || 0) - totalUsed
    );
    
    if (!institutionDoc.alerts) institutionDoc.alerts = {};
    institutionDoc.alerts.emailLowBalance = institutionDoc.emailDetails.remaining < 50;

    await bulkSendMail.save();
    await institutionDoc.save();

    // Create logs if functions exist
    if (typeof createAddUserBulkLog === 'function') {
      const logData = { batch, courses: validCourses };
      await createAddUserBulkLog(req, users, "email", logData);
    }
    if (typeof createBulkUploadLog === 'function') {
      await createBulkUploadLog(req, {
        users,
        notificationMethod: "email",
        fileName: uniqueFileName,
        totalUsers: results.length,
        sentEmails: sentEmails.length,
        notSentEmails: notSentEmails.length,
        existingUsers: existingUsers.length,
        batch: batch && batch.trim() ? batch.trim() : undefined,
        courses: validCourses.length > 0 ? validCourses : undefined,
      });
    }

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Prepare response message
    let successMessage = `Successfully registered ${users.length} users`;
    if (batch && batch.trim()) {
      successMessage += ` to batch "${batch.trim()}"`;
    }
    if (sentEmails.length > 0) {
      successMessage += ` and sent ${sentEmails.length} welcome emails`;
    }
    
    if (creditExceeded) {
      successMessage += ". Some emails failed due to insufficient credits.";
    } else {
      successMessage += ".";
    }

    // Send response
    const response = {
      message: [
        {
          key: "success",
          value: successMessage,
        },
      ],
      summary: {
        totalProcessed: results.length,
        successfullyCreated: users.length,
        emailsSent: sentEmails.length,
        emailsFailed: notSentEmails.length,
        existingUsers: existingUsers.length,
        validationErrors: validationErrors.length
      },
      users: users.map(user => {
        const userResponse = {
          _id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role
        };
        
        // Add batch if exists
        if (user.batch) {
          userResponse.batch = user.batch;
        }
        
        // Add courses if exist
        if (user.enrolledCourses && user.enrolledCourses.length > 0) {
          userResponse.enrolledCourses = user.enrolledCourses;
        }
        
        return userResponse;
      }),
      creditExceeded,
    };

    // Add batch and courses to response if provided
    if (batch && batch.trim()) {
      response.summary.batch = batch.trim();
    }
    if (validCourses.length > 0) {
      response.summary.courses = validCourses;
      response.summary.courseCount = validCourses.length;
    }

    res.status(201).json(response);

  } catch (error) {
    console.error("Error uploading users:", error);
    
    // Clean up file in case of error
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    res.status(500).json({
      message: [{ key: "error", value: "Internal server error" }],
    });
  }
};






exports.UpdateUserWithPermission = async (req, res) => {
  try {
    const { userId } = req.params;
    const { permissions } = req.body;

    // Find existing user
    const existingUser = await User.findById(userId);
    if (!existingUser) {
      return res.status(404).json({
        message: [{ key: "error", value: "User not found" }],
      });
    }

    // Validate permissions input
    if (!permissions || !Array.isArray(permissions)) {
      return res.status(400).json({
        message: [{ key: "error", value: "Permissions array is required" }],
      });
    }

    // Validate and transform permissions structure
    const validPermissions = permissions.map((perm, index) => {
      // Check required fields
      if (!perm.permissionName || !perm.permissionKey) {
        throw new Error(`Permission at index ${index} must have permissionName and permissionKey`);
      }

      return {
        permissionName: perm.permissionName,
        permissionKey: perm.permissionKey,
        permissionFunctionality: Array.isArray(perm.permissionFunctionality) 
          ? perm.permissionFunctionality 
          : [],
        icon: perm.icon || "Shield", // Default icon if not provided
        color: perm.color || "blue", // Default color if not provided
        description: perm.description || "",
        isActive: perm.isActive !== undefined ? Boolean(perm.isActive) : true,
        order: typeof perm.order === 'number' ? perm.order : index
      };
    });

    // Check for duplicate permission keys
    const permissionKeys = validPermissions.map(p => p.permissionKey);
    const uniqueKeys = new Set(permissionKeys);
    if (uniqueKeys.size !== permissionKeys.length) {
      return res.status(400).json({
        message: [{ key: "error", value: "Duplicate permission keys found" }],
      });
    }

    // Update ONLY permissions field
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        $set: { permissions: validPermissions },
        updatedAt: new Date()
      },
      {
        new: true,
        runValidators: true,
        select: 'firstName lastName email role permissions createdAt updatedAt'
      }
    )
    .populate("role", "originalRole renameRole roleValue");

    if (!updatedUser) {
      return res.status(404).json({
        message: [{ key: "error", value: "User not found during update" }],
      });
    }

    res.status(200).json({
      message: [{ key: "success", value: "User permissions updated successfully" }],
      data: {
        user: {
          _id: updatedUser._id,
          email: updatedUser.email,
          firstName: updatedUser.firstName,
          lastName: updatedUser.lastName,
          role: updatedUser.role,
        },
        permissions: updatedUser.permissions,
        updatedAt: updatedUser.updatedAt
      }
    });
  } catch (error) {
    console.error("Error updating user permissions:", error);

    if (error.name === "ValidationError") {
      const errors = Object.keys(error.errors).map((key) => ({
        key,
        value: error.errors[key].message,
      }));
      return res.status(400).json({ message: errors });
    }

    if (error.message.includes('Permission at index')) {
      return res.status(400).json({
        message: [{ key: "error", value: error.message }],
      });
    }

    res.status(500).json({
      message: [
        { key: "error", value: "Internal server error while updating permissions" },
      ],
    });
  }
};


exports.bulkUpdatePermissions = async (req, res) => {
  try {
    const { userPermissions } = req.body;

    // Validate input
    if (!userPermissions || !Array.isArray(userPermissions)) {
      return res.status(400).json({
        message: [{ key: "error", value: "userPermissions array is required" }],
      });
    }

    if (userPermissions.length === 0) {
      return res.status(400).json({
        message: [{ key: "error", value: "No user permissions provided" }],
      });
    }

    const results = [];
    const errors = [];
    let successCount = 0; // Changed from const to let

    // Process each user's permissions
    for (const item of userPermissions) {
      try {
        const { userId, permissions } = item;

        // Validate required fields
        if (!userId) {
          errors.push({ userId: 'unknown', error: "User ID is required" });
          continue;
        }

        if (!permissions || !Array.isArray(permissions)) {
          errors.push({ userId, error: "Permissions array is required" });
          continue;
        }

        // Find user
        const user = await User.findById(userId);
        if (!user) {
          errors.push({ userId, error: "User not found" });
          continue;
        }

        // Validate and transform permissions
        const validPermissions = permissions.map((perm, index) => {
          // Basic validation
          if (!perm.permissionName || !perm.permissionKey) {
            throw new Error(`Permission at index ${index} must have permissionName and permissionKey`);
          }

          return {
            permissionName: perm.permissionName,
            permissionKey: perm.permissionKey,
            permissionFunctionality: Array.isArray(perm.permissionFunctionality) 
              ? perm.permissionFunctionality 
              : [],
            icon: perm.icon || "Shield",
            color: perm.color || "blue",
            description: perm.description || "",
            isActive: perm.isActive !== undefined ? Boolean(perm.isActive) : true,
            order: typeof perm.order === 'number' ? perm.order : index
          };
        });

        // Check for duplicate permission keys
        const permissionKeys = validPermissions.map(p => p.permissionKey);
        const uniqueKeys = new Set(permissionKeys);
        if (uniqueKeys.size !== permissionKeys.length) {
          errors.push({ userId, error: "Duplicate permission keys found" });
          continue;
        }

        // Update user permissions
        user.permissions = validPermissions;
        user.updatedAt = new Date();

        await user.save();

        results.push({
          userId,
          success: true,
          user: {
            _id: user._id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role
          },
          permissionsCount: validPermissions.length
        });

        successCount++; // This line was causing the error

      } catch (error) {
        console.error(`Error processing user ${item.userId}:`, error);
        errors.push({
          userId: item.userId || 'unknown',
          error: error.message || "Internal server error"
        });
      }
    }

    // Prepare response
    const response = {
      message: [
        { 
          key: "success", 
          value: `Bulk update completed. Success: ${successCount}, Failed: ${errors.length}` 
        }
      ],
      data: {
        summary: {
          total: userPermissions.length,
          successful: successCount,
          failed: errors.length
        },
        results,
        errors: errors.length > 0 ? errors : undefined
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error("Error in bulk permission update:", error);
    
    if (error.name === "ValidationError") {
      const errors = Object.keys(error.errors).map((key) => ({
        key,
        value: error.errors[key].message,
      }));
      return res.status(400).json({ message: errors });
    }

    res.status(500).json({
      message: [
        { key: "error", value: "Internal server error during bulk update" },
      ],
    });
  }
};



exports.GetUserPermission = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId)
      .populate("role", "originalRole renameRole roleValue")
      .select("firstName lastName email permissions role");

    if (!user) {
      return res.status(404).json({
        message: [{ key: "error", value: "User not found" }],
      });
    }

    res.status(200).json({
      message: [{ key: "success", value: "User permission retrieved successfully" }],
      data: {
        user: {
          _id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
        permissions: user.permissions || []
      },
    });
  } catch (error) {
    console.error("Error getting user permission:", error);
    res.status(500).json({
      message: [
        { key: "error", value: "Internal server error while getting user permission" },
      ],
    });
  }
};


exports.GetMyPermission = async (req, res) => {
  try {
    // Get user ID from authenticated request (from your auth middleware)
    const userId = req.user._id;

    if (!userId) {
      return res.status(401).json({
        message: [{ key: "error", value: "User not authenticated" }],
      });
    }

    // Get user with permission and role details
    const user = await User.findById(userId)
      .populate("role", "originalRole renameRole roleValue permissions")
      .populate("institution", "institutionName")
      .select("firstName lastName email permission role institution status createdAt");

    if (!user) {
      return res.status(404).json({
        message: [{ key: "error", value: "User not found" }],
      });
    }

    // Format permission data
    const permissionData = user.permission || {};
    
    // Combine role permissions and user permissions if needed
    const combinedPermissions = {
      userPermission: permissionData,
      rolePermission: user.role?.permissions || {},
      roleDetails: {
        originalRole: user.role?.originalRole,
        renameRole: user.role?.renameRole,
        roleValue: user.role?.roleValue,
      },
      institution: user.institution,
    };

    // Check if user has any permission access
    const hasPermissionAccess = permissionData.permissions || user.role?.permissions;

    res.status(200).json({
      message: [{ key: "success", value: "User permission retrieved successfully" }],
      data: {
        user: {
          _id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: `${user.firstName} ${user.lastName}`,
          status: user.status,
          createdAt: user.createdAt,
        },
        permissions: combinedPermissions,
        hasPermissionAccess: !!hasPermissionAccess,
        permissionSummary: {
          mainPermission: permissionData.permissions || "No main permission set",
          functionalities: permissionData.permissionFunctionality || [],
          subPermissionsCount: permissionData.subPermission?.length || 0,
          role: user.role?.originalRole || user.role?.renameRole || "No role assigned",
        },
      },
    });
  } catch (error) {
    console.error("Error getting user permission:", error);
    res.status(500).json({
      message: [
        { key: "error", value: "Internal server error while getting user permission" },
      ],
    });
  }
};




