
import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebase/config";

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      onLogin(result.user);
    } catch (err) {
      setError(
        err.code === "auth/invalid-credential"
          ? "Email or password is incorrect."
          : err.code === "auth/too-many-requests"
          ? "Too many attempts. Try again later."
          : err.message
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{
      minHeight: "100vh", display: "grid", placeItems: "center",
      background: "#f4f0ff", padding: 20, fontFamily: "Arial"
    }}>
      <form onSubmit={handleSubmit} style={{
        width: "100%", maxWidth: 390, background: "white",
        padding: 32, borderRadius: 20, boxShadow: "0 12px 40px #30205a12"
      }}>
        <div style={{ color: "#7455c6", fontSize: 35 }}>✝</div>
        <h1 style={{ color: "#29253c" }}>Smart Rosary</h1>
        <p style={{ color: "#898398" }}>Administrator sign in</p>

        <label style={{ display: "block", marginTop: 22 }}>
          Email
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={fieldStyle}
          />
        </label>

        <label style={{ display: "block", marginTop: 16 }}>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={fieldStyle}
          />
        </label>

        {error && (
          <p role="alert" style={{ color: "#b42318", marginTop: 14 }}>
            {error}
          </p>
        )}

        <button disabled={loading} style={{
          width: "100%", marginTop: 22, padding: 13, border: 0,
          borderRadius: 9, background: "#7455c6", color: "white",
          fontWeight: 700, cursor: "pointer"
        }}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}

const fieldStyle = {
  display: "block", width: "100%", boxSizing: "border-box",
  padding: 12, marginTop: 8, border: "1px solid #e4dfed",
  borderRadius: 8, outlineColor: "#7455c6"
};
