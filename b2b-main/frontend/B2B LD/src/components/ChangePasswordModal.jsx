import { useState } from "react";
import { apiRequest } from "../lib/api";
import { passwordStrengthError, PASSWORD_HINT } from "../lib/validation";
import Modal from "./Modal";

const inputStyle = { background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#1e293b" };

const ChangePasswordModal = ({ onClose, onChanged }) => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const passwordError = passwordStrengthError(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match");
      return;
    }
    setSaving(true);
    try {
      await apiRequest("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Change Password" subtitle="Update the password you log in with" onClose={onClose} width="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="text-xs font-medium px-3 py-2 rounded-lg" style={{ background: "#FDECEC", color: "#C0392B" }}>{error}</p>
        )}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: "#5B7285" }}>Current Password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className="w-full px-3 py-2.5 text-sm rounded-xl outline-none"
            style={inputStyle}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: "#5B7285" }}>New Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            placeholder={PASSWORD_HINT}
            className="w-full px-3 py-2.5 text-sm rounded-xl outline-none"
            style={inputStyle}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: "#5B7285" }}>Confirm New Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            className="w-full px-3 py-2.5 text-sm rounded-xl outline-none"
            style={inputStyle}
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: "#F3F8FB", border: "1px solid #D8E6F0", color: "#5B7285" }}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}>
            {saving ? "Saving..." : "Change Password"}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default ChangePasswordModal;
