"use client";

import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { useState } from "react";
import { BrandMark } from "./VisualAssets";

type Mode = "register" | "login";

export default function AuthPanel({
  serviceReady = true,
}: {
  serviceReady?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("register");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function post(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = (await response.json()) as {
      error?: string;
      options?: Parameters<typeof startRegistration>[0]["optionsJSON"];
    };
    if (!response.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }
  async function register(event: React.FormEvent) {
    event.preventDefault();
    if (!serviceReady) return;
    const form = new FormData(event.currentTarget as HTMLFormElement);
    setBusy(true);
    setError("");
    try {
      const data = await post("/api/auth/register/options", {
        displayName: form.get("displayName"),
        handle: form.get("handle"),
      });
      if (!data.options)
        throw new Error("GitNorm could not start passkey setup.");
      const credential = await startRegistration({ optionsJSON: data.options });
      await post("/api/auth/register/verify", credential);
      location.assign("/");
    } catch (reason) {
      setError(friendly(reason));
    } finally {
      setBusy(false);
    }
  }
  async function login() {
    if (!serviceReady) return;
    setBusy(true);
    setError("");
    try {
      const data = await post("/api/auth/login/options");
      if (!data.options) throw new Error("GitNorm could not start sign in.");
      const credential = await startAuthentication({
        optionsJSON: data.options,
      });
      await post("/api/auth/login/verify", credential);
      location.assign("/");
    } catch (reason) {
      setError(friendly(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="auth-card"
      id="get-started"
      aria-labelledby="auth-title"
    >
      {!serviceReady ? (
        <div className="auth-unavailable" role="status">
          <div className="auth-icon">
            <BrandMark />
          </div>
          <h2 id="auth-title">The doors are almost open.</h2>
          <p>
            We’re connecting the secure vault behind GitNorm. New accounts are
            paused until every app and every version can be protected properly.
          </p>
          <span>Worth the short wait.</span>
        </div>
      ) : (
        <>
          <div className="auth-tabs">
            <button
              className={mode === "register" ? "active" : ""}
              onClick={() => {
                setMode("register");
                setError("");
              }}
            >
              Create account
            </button>
            <button
              className={mode === "login" ? "active" : ""}
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              Sign in
            </button>
          </div>
          {mode === "register" ? (
            <form onSubmit={register}>
              <div className="auth-icon">
                <BrandMark />
              </div>
              <h2 id="auth-title">Start your body of work.</h2>
              <p>
                One private home for everything you build. Your device creates a
                passkey—no password and no ChatGPT account.
              </p>
              <label>
                Your name
                <input
                  name="displayName"
                  required
                  minLength={2}
                  maxLength={60}
                  autoComplete="name"
                  placeholder="Alex Rivera"
                />
              </label>
              <label>
                Your public handle
                <div className="handle-input">
                  <span>@</span>
                  <input
                    name="handle"
                    required
                    minLength={3}
                    maxLength={30}
                    pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{1,28}[a-zA-Z0-9]"
                    autoCapitalize="none"
                    autoComplete="username webauthn"
                    value={handle}
                    onChange={(event) =>
                      setHandle(event.target.value.toLowerCase())
                    }
                    placeholder="alexmakes"
                  />
                </div>
              </label>
              <button className="primary-button full" disabled={busy}>
                {busy ? "Waiting for your device…" : "Create my account →"}
              </button>
              <small>
                Everything starts private. Share only when you’re proud of it.
              </small>
            </form>
          ) : (
            <div className="auth-login">
              <div className="auth-icon">
                <BrandMark />
              </div>
              <h2 id="auth-title">Pick up where you left off.</h2>
              <p>
                Your passkey brings you straight back to every app and every
                version you’ve saved.
              </p>
              <button
                className="primary-button full"
                disabled={busy}
                onClick={() => void login()}
              >
                {busy ? "Waiting for your device…" : "Sign in with a passkey →"}
              </button>
              <small>No ChatGPT login. No password to remember.</small>
            </div>
          )}
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function friendly(reason: unknown) {
  const message =
    reason instanceof Error ? reason.message : "Something went wrong.";
  if (/notallowed|cancel|timed out/i.test(message))
    return "The passkey prompt was cancelled or timed out. Try again when you’re ready.";
  if (/secure context|not supported/i.test(message))
    return "Passkeys need a current browser on HTTPS. Try Safari, Chrome, Edge, or Firefox.";
  return message;
}
