import express from "express";
import bcrypt from "bcryptjs";
import authMiddleware from "../middleware/auth.js";
import User from "../models/User.js";

const router = express.Router();

// ─── GET /api/users/profile ───
// Get current user profile (excluding sensitive fields)
router.get("/profile", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("-password -__v -otp -otpExpires")
      .lean();
    
    if (!user) {
      return res.status(404).json({ 
        error: "User not found",
        message: "The requested user account does not exist"
      });
    }
    
    // Ensure preferences have defaults if missing
    if (!user.preferences) {
      user.preferences = {
        theme: "dark",
        temperature: 0.7,
        systemPrompt: "",
        fontSize: 14,
        sidebarCollapsed: false,
        voiceEnabled: true
      };
    }
    
    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar: user.avatar,
        preferences: user.preferences,
        lastActive: user.lastActive,
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    console.error("❌ Profile fetch error:", err);
    res.status(500).json({ 
      success: false,
      error: "Failed to fetch profile",
      message: process.env.NODE_ENV === "development" ? err.message : "Internal server error"
    });
  }
});

// ─── PUT /api/users/profile ───
// Update user profile (name, preferences, optional password)
router.put("/profile", authMiddleware, async (req, res) => {
  try {
    const { name, password, preferences } = req.body;
    const updateData = {};
    const errors = [];

    // ── Validate & Sanitize Name ──
    if (name !== undefined) {
      const sanitizedName = name.trim();
      if (sanitizedName.length < 2) {
        errors.push("Name must be at least 2 characters");
      } else if (sanitizedName.length > 50) {
        errors.push("Name must be less than 50 characters");
      } else if (!/^[\p{L}\p{N}\s._-]+$/u.test(sanitizedName)) {
        errors.push("Name contains invalid characters");
      } else {
        updateData.name = sanitizedName;
      }
    }

    // ── Validate & Merge Preferences ──
    if (preferences !== undefined) {
      updateData.preferences = {};
      
      // Theme validation
      if (preferences.theme !== undefined) {
        const validThemes = ["light", "dark", "system"];
        if (!validThemes.includes(preferences.theme)) {
          errors.push(`Theme must be one of: ${validThemes.join(", ")}`);
        } else {
          updateData.preferences.theme = preferences.theme;
        }
      }
      
      // Temperature validation (0-2)
      if (preferences.temperature !== undefined) {
        const temp = parseFloat(preferences.temperature);
        if (isNaN(temp) || temp < 0 || temp > 2) {
          errors.push("Temperature must be a number between 0 and 2");
        } else {
          updateData.preferences.temperature = Math.round(temp * 10) / 10; // Round to 1 decimal
        }
      }
      
      // System prompt validation
      if (preferences.systemPrompt !== undefined) {
        if (preferences.systemPrompt.length > 2000) {
          errors.push("System prompt must be less than 2000 characters");
        } else {
          updateData.preferences.systemPrompt = preferences.systemPrompt.trim();
        }
      }
      
      // Font size validation
      if (preferences.fontSize !== undefined) {
        const size = parseInt(preferences.fontSize);
        if (isNaN(size) || size < 12 || size > 24) {
          errors.push("Font size must be between 12 and 24");
        } else {
          updateData.preferences.fontSize = size;
        }
      }
      
      // Boolean preferences
      ["sidebarCollapsed", "voiceEnabled"].forEach(key => {
        if (preferences[key] !== undefined) {
          if (typeof preferences[key] !== "boolean") {
            errors.push(`${key} must be a boolean value`);
          } else {
            updateData.preferences[key] = preferences[key];
          }
        }
      });
    }

    // ── Validate & Hash Password (if provided) ──
    if (password !== undefined && password !== "") {
      if (password.length < 8) {
        errors.push("Password must be at least 8 characters");
      } else if (password.length > 128) {
        errors.push("Password must be less than 128 characters");
      } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
        errors.push("Password must contain uppercase, lowercase, and number");
      } else {
        updateData.password = await bcrypt.hash(password, 12);
      }
    }

    // ── Return validation errors if any ──
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        errors: errors
      });
    }

    // ── Update the user ──
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateData, $currentDate: { lastActive: true } },
      { 
        new: true, 
        runValidators: true,
        context: "query"
      }
    ).select("-password -__v -otp -otpExpires").lean();

    if (!updatedUser) {
      return res.status(404).json({ 
        success: false,
        error: "User not found",
        message: "The requested user account does not exist"
      });
    }

    // ── Log security event for password changes ──
    if (updateData.password) {
      console.log(`[Security] Password changed for user: ${req.user.email}`);
    }

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: updatedUser._id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        avatar: updatedUser.avatar,
        preferences: updatedUser.preferences,
        lastActive: updatedUser.lastActive
      }
    });

  } catch (err) {
    console.error("❌ Profile update error:", err);
    
    // Handle MongoDB validation errors
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({
        success: false,
        error: "Validation failed",
        errors: messages
      });
    }
    
    // Handle duplicate key errors
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "Conflict",
        message: "A user with this email already exists"
      });
    }
    
    res.status(500).json({ 
      success: false,
      error: "Failed to update profile",
      message: process.env.NODE_ENV === "development" ? err.message : "Internal server error"
    });
  }
});

// ─── PUT /api/users/password ───
// Change password with current password verification
router.put("/password", authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // ── Basic validation ──
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: "Missing fields",
        message: "Both current and new password are required"
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: "Weak password",
        message: "New password must be at least 8 characters"
      });
    }

    if (newPassword.length > 128) {
      return res.status(400).json({
        success: false,
        error: "Password too long",
        message: "Password must be less than 128 characters"
      });
    }

    // ── Password strength check ──
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      return res.status(400).json({
        success: false,
        error: "Weak password",
        message: "Password must contain uppercase, lowercase, and number"
      });
    }

    // ── Prevent reusing same password ──
    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        error: "Same password",
        message: "New password must be different from current password"
      });
    }

    // ── Get user with password field ──
    const user = await User.findById(req.user.id).select("+password").lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
        message: "The requested user account does not exist"
      });
    }

    // ── Verify current password ──
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      // Log failed attempt for security monitoring
      console.warn(`[Security] Failed password change attempt for: ${req.user.email}`);
      
      return res.status(401).json({
        success: false,
        error: "Authentication failed",
        message: "Current password is incorrect"
      });
    }

    // ── Update password ──
    user.password = await bcrypt.hash(newPassword, 12);
    user.lastActive = new Date();
    await user.save();

    // ── Log successful password change ──
    console.log(`[Security] Password successfully changed for: ${req.user.email}`);

    res.json({
      success: true,
      message: "Password updated successfully",
      // Don't return the user object to force re-authentication if needed
    });

  } catch (err) {
    console.error("❌ Password change error:", err);
    res.status(500).json({ 
      success: false,
      error: "Failed to change password",
      message: process.env.NODE_ENV === "development" ? err.message : "Internal server error"
    });
  }
});

// ─── DELETE /api/users/profile ───
// Soft delete user account (optional feature)
router.delete("/profile", authMiddleware, async (req, res) => {
  try {
    // Optional: Add confirmation step or 2FA here for security
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found"
      });
    }

    // Soft delete: Mark as inactive instead of removing
    user.isActive = false;
    user.deletedAt = new Date();
    await user.save();

    console.log(`[Security] Account deactivated: ${req.user.email}`);

    res.json({
      success: true,
      message: "Account deactivated successfully"
    });

  } catch (err) {
    console.error("❌ Account deletion error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to deactivate account",
      message: process.env.NODE_ENV === "development" ? err.message : "Internal server error"
    });
  }
});

export default router;