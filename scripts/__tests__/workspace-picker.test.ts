import { describe, expect, it } from "vitest";
import { createWindowsFolderPicker } from "../workspace-picker.cjs";

type PickerCallback = (error: Error | null, stdout: string, stderr: string) => void;

describe("Windows workspace folder picker", () => {
  it("returns an explicit cancelled result without treating it as an error", async () => {
    const picker = createWindowsFolderPicker({
      platform: "win32",
      execFile: (...args: unknown[]) => (args.at(-1) as PickerCallback)(null, "\n", ""),
    });
    await expect(picker.pick()).resolves.toEqual({ status: "cancelled" });
  });

  it("returns the selected path and never interpolates caller data into a shell command", async () => {
    let invocation: { file: string; args: string[] } | undefined;
    const picker = createWindowsFolderPicker({
      platform: "win32",
      execFile: (...allArgs: unknown[]) => {
        const [file, commandArgs] = allArgs as [string, string[]];
        invocation = { file, args: commandArgs };
        (allArgs.at(-1) as PickerCallback)(null, "C:\\Work\\safe-project\n", "");
      },
    });
    await expect(picker.pick()).resolves.toEqual({ status: "selected", path: "C:\\Work\\safe-project" });
    expect(invocation?.file.toLowerCase()).toContain("powershell");
    expect(invocation?.args).toContain("-NoProfile");
    expect(invocation?.args.join(" ")).not.toContain("safe-project");
  });

  it("reports native picker failures without exposing command execution", async () => {
    const picker = createWindowsFolderPicker({
      platform: "win32",
      execFile: (...args: unknown[]) => (args.at(-1) as PickerCallback)(new Error("picker unavailable"), "", ""),
    });
    await expect(picker.pick()).resolves.toEqual({ status: "error", code: "picker_unavailable" });
  });
});
