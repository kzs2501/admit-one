import { render, screen } from "@testing-library/react";
import { encode } from "uqr";
import { describe, expect, it } from "vitest";
import { qrPath, QrCode } from "./qr-code";

const UPI_INTENT = "upi://pay?pa=dresscircle@example&pn=Dress%20Circle&mc=7922&tr=pay_1&tn=x&am=303.73&cu=INR";

describe("qrPath", () => {
  it("draws each run of dark modules in a row as one rectangle", () => {
    expect(
      qrPath([
        [true, true, false, true],
        [false, false, false, false],
        [false, true, true, true],
      ]),
    ).toBe("M0 0h2v1h-2zM3 0h1v1h-1zM1 2h3v1h-3z");
  });
});

describe("QrCode", () => {
  it("is a labelled image, black on white, sized to the code with its quiet zone", () => {
    render(<QrCode value={UPI_INTENT} label="QR code to pay ₹303.73 to Dress Circle with UPI" />);
    const image = screen.getByRole("img", { name: "QR code to pay ₹303.73 to Dress Circle with UPI" });
    const { size, data } = encode(UPI_INTENT, { ecc: "M", border: 4 });
    expect(image).toHaveAttribute("viewBox", `0 0 ${String(size)} ${String(size)}`);
    expect(image.querySelector("rect")).toHaveAttribute("fill", "#fff");
    expect(image.querySelector("path")).toHaveAttribute("d", qrPath(data));
    expect(data[0]?.[0]).toBe(false); // the quiet zone is light
  });
});
