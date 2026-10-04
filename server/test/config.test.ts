import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const valid = {
  APP_URL: "https://todo.example.com",
  OIDC_ISSUER: "https://auth.example.com",
  OIDC_CLIENT_ID: "moli-todo",
  OIDC_CLIENT_SECRET: "secret-value",
};

describe("loadConfig", () => {
  it("reads the settings and fills in defaults", () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({
      PORT: 3000,
      SESSION_DAYS: 30,
      APP_VERSION: "dev",
      DATABASE_PATH: "./data/todo.db",
    });
  });

  it("names every missing or bad variable, and never prints a value", () => {
    expect(() =>
      loadConfig({
        ...valid,
        OIDC_CLIENT_SECRET: "",
        APP_URL: "https://todo.example.com/path",
        PORT: "abc",
      })
    ).toThrow(/APP_URL.*OIDC_CLIENT_SECRET|OIDC_CLIENT_SECRET.*APP_URL/);
    try {
      loadConfig({ ...valid, OIDC_CLIENT_SECRET: "", PORT: "abc" });
    } catch (error) {
      expect(String(error)).not.toContain("secret-value");
    }
  });
});
