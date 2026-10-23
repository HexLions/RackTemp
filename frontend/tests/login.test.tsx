import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import App from "../src/App";
import { AuthProvider } from "../src/api/AuthContext";
import Login from "../src/pages/Login";
import { fakeApi } from "./fakeApi";

const noSession = { "GET /api/auth/me": { status: 401, body: { error: "not authenticated" } } };

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>home page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function submitCredentials(username: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Username"), username);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Log in" }));
  return user;
}

describe("login", () => {
  it("sends a visitor without a session to the login page", async () => {
    fakeApi(noSession);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText("Username")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
  });

  it("shows the server's error on wrong credentials", async () => {
    fakeApi({ ...noSession, "POST /api/auth/login": { status: 401, body: { error: "invalid credentials" } } });
    renderLogin();
    await submitCredentials("admin1", "wrong-password");
    expect(await screen.findByText("invalid credentials")).toBeTruthy();
  });

  it("asks for the MFA code when the server requires it, then logs in", async () => {
    const fetchMock = fakeApi({
      ...noSession,
      "POST /api/auth/login": { status: 200, body: { mfaRequired: true } },
      "POST /api/auth/mfa/login": (body) =>
        (body as { code: string }).code === "123456"
          ? { status: 200, body: { username: "admin1", mustChangePassword: false } }
          : { status: 401, body: { error: "invalid code" } },
    });
    renderLogin();
    const user = await submitCredentials("admin1", "correct-horse-battery");

    await user.type(await screen.findByLabelText("Code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("home page")).toBeTruthy();
    const mfaCall = fetchMock.mock.calls.find(([url]) => url === "/api/auth/mfa/login");
    expect(mfaCall?.[1]?.body).toBe(JSON.stringify({ code: "123456" }));
  });

  it("stays on the MFA step and shows the error on a wrong code", async () => {
    fakeApi({
      ...noSession,
      "POST /api/auth/login": { status: 200, body: { mfaRequired: true } },
      "POST /api/auth/mfa/login": { status: 401, body: { error: "invalid code" } },
    });
    renderLogin();
    const user = await submitCredentials("admin1", "correct-horse-battery");

    await user.type(await screen.findByLabelText("Code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("invalid code")).toBeTruthy();
    expect(screen.getByLabelText("Code")).toBeTruthy();
    expect(screen.queryByText("home page")).toBeNull();
  });
});
