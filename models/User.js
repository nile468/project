import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 8, select: false },
  name: { type: String, default: "User", trim: true },
  role: { type: String, enum: ["user", "premium", "admin"], default: "user" },
  avatar: { type: String, default: null },
  preferences: {
    theme: { type: String, enum: ["light", "dark", "system"], default: "dark" },
    temperature: { type: Number, default: 0.7, min: 0, max: 2 },
    systemPrompt: { type: String, default: "" }
  },
  lastActive: { type: Date, default: Date.now }
}, { timestamps: true });

userSchema.pre("save", async function(next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  return obj;
};

export default mongoose.model("User", userSchema);