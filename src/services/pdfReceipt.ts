import PDFDocument from "pdfkit";
import { Transaction } from "../models/transaction";

export async function generateTransactionPdfBuffer(
  transaction: Transaction,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      // Header
      doc.fontSize(20).text("Mobile Money", { align: "left" });
      doc.moveDown(0.25);
      doc
        .fontSize(10)
        .fillColor("#666")
        .text(`Receipt ID: ${transaction.referenceNumber}`);
      doc
        .fontSize(10)
        .fillColor("#666")
        .text(`Transaction ID: ${transaction.id}`);
      doc.moveDown(0.5);

      // Divider line
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#eeeeee").stroke();
      doc.moveDown(0.5);

      // Main details
      const leftX = 50;
      const rightX = 400;

      doc.fillColor("#000").fontSize(12).text("Details", leftX);

      doc.fontSize(10).text(`Type: ${transaction.type}`, leftX, doc.y + 6);
      doc.text(`Provider: ${transaction.provider}`, leftX);
      doc.text(`Phone: ${transaction.phoneNumber}`, leftX);
      if (transaction.stellarAddress)
        doc.text(`Stellar: ${transaction.stellarAddress}`, leftX);

      const amountStr = transaction.amount;
      doc.fontSize(12).text(`Amount`, rightX, 140, { continued: false });
      doc.fontSize(14).text(`${amountStr}`, rightX, 158, { align: "right" });

      doc.moveDown(1.5);

      // Status and timestamps
      doc
        .fontSize(10)
        .fillColor("#333")
        .text(`Status: ${transaction.status}`, leftX);
      doc.text(
        `Created: ${new Date(transaction.createdAt).toLocaleString()}`,
        leftX,
      );

      if (transaction.notes) {
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor("#000").text("Notes", leftX);
        doc
          .fontSize(10)
          .fillColor("#333")
          .text(transaction.notes || "", { width: 500 });
      }

      // Footer
      doc.moveDown(2);
      doc
        .fontSize(9)
        .fillColor("#999")
        .text(`Generated at ${new Date().toLocaleString()}`, {
          align: "center",
        });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
