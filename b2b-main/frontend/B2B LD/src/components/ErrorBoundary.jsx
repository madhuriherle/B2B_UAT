import { Component } from "react";

// React only catches render/lifecycle errors with a class component's
// getDerivedStateFromError — there's no hook equivalent. Without this
// wrapping the app, ANY uncaught error anywhere in the tree (a bad API
// response shape, a missing field on one org's data, ...) unmounts React
// entirely, leaving a permanently blank white page with no way back short
// of typing a URL by hand — the "blank page after clicking Create Order"
// symptom. This turns that into a recoverable screen instead, for every
// page, not just the one that happened to crash first.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled error caught by ErrorBoundary:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#F3F8FB" }}>
        <div className="w-full max-w-md rounded-2xl p-8 text-center" style={{ background: "#fff", border: "1px solid #D8E6F0", boxShadow: "0 8px 24px rgba(30,96,145,0.1)" }}>
          <h1 className="text-lg font-bold mb-2" style={{ color: "#0f172a" }}>Something went wrong</h1>
          <p className="text-sm mb-6" style={{ color: "#5B7285" }}>
            This page ran into an unexpected error. Reloading usually fixes it — your login stays intact.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #1E6091, #16A34A)" }}
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
