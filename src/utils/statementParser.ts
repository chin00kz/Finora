import * as pdfjsLib from 'pdfjs-dist';
import { differenceInCalendarDays, parse } from 'date-fns';
import type {
  ParsedStatement,
  StatementTransaction,
  StatementInstallmentPlan,
} from '../db/db';

// Configure pdfjs worker for Vite environment
if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  } catch (e) {
    console.warn('Could not set pdfjs worker from URL, fallback to default', e);
  }
}

interface ExtractedTextItem {
  str: string;
  x: number;
  y: number;
  hasEOL?: boolean;
}

/**
 * Extracts raw lines from PDF file in client browser with coordinate preservation.
 */
export async function extractLinesFromPdf(fileOrBuffer: File | ArrayBuffer): Promise<string[]> {
  const arrayBuffer = fileOrBuffer instanceof File ? await fileOrBuffer.arrayBuffer() : fileOrBuffer;
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useWorkerFetch: true,
    useSystemFonts: true,
  });

  const pdf = await loadingTask.promise;
  const allLines: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const items: ExtractedTextItem[] = [];

    for (const item of textContent.items) {
      if ('str' in item && item.str.trim().length > 0) {
        items.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          hasEOL: item.hasEOL,
        });
      }
    }

    // Group items by line: items whose y-coordinates are within 3.5 points
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    const lines: ExtractedTextItem[][] = [];
    let currentLine: ExtractedTextItem[] = [];
    let currentY: number | null = null;

    for (const item of items) {
      if (currentY === null || Math.abs(item.y - currentY) < 3.5) {
        currentLine.push(item);
        currentY = item.y;
      } else {
        // Sort line items from left to right
        currentLine.sort((a, b) => a.x - b.x);
        lines.push(currentLine);
        currentLine = [item];
        currentY = item.y;
      }
    }

    if (currentLine.length > 0) {
      currentLine.sort((a, b) => a.x - b.x);
      lines.push(currentLine);
    }

    for (const line of lines) {
      const lineStr = line.map(i => i.str.trim()).join(' ');
      if (lineStr.length > 0) {
        allLines.push(lineStr);
      }
    }
  }

  return allLines;
}

/**
 * Parses numeric string formatted as "12,345.67" or "12345.67" or "12,345.67 CR"
 */
function parseAmount(str: string): { amount: number; isCredit: boolean } | null {
  if (!str) return null;
  const isCredit = /CR\b/i.test(str) || str.endsWith('-');
  const cleaned = str
    .replace(/LKR|Rs\.?|CR/gi, '')
    .replace(/[^\d.-]/g, '')
    .trim();
  const val = parseFloat(cleaned);
  if (isNaN(val)) return null;
  return { amount: Math.abs(val), isCredit };
}

/**
 * Keyword-based category categorization
 */
export function inferCategory(description: string, isCredit: boolean): string {
  if (isCredit) return 'Payments & Credits';
  const desc = description.toLowerCase();

  if (/flexiplan|installment|easy payment|0% ip\b/i.test(desc)) {
    return 'Installments';
  }
  if (/keells|cargills|arpico|spar|glomark|supermarket|grocery|mart\b/i.test(desc)) {
    return 'Supermarkets & Groceries';
  }
  if (/uber\s*eats|pickme\s*food|pizza|mcdonald|kfc|restaurant|cafe|burger|bakers|coffee|barista|breadtalk|pastry|dining|food/i.test(desc)) {
    return 'Food & Dining';
  }
  if (/uber\s*trip|pickme|fuel|petrol|ceypetco|ioc|lafs|filling\s*station|parking|transport|highway/i.test(desc)) {
    return 'Transport & Fuel';
  }
  if (/ceb|leco|water\s*board|telecom|dialog|mobitel|slt|airtel|hutch|insurance|utility|electric/i.test(desc)) {
    return 'Bills & Utilities';
  }
  if (/daraz|amazon|aliexpress|ebay|apple|google|netflix|spotify|fashion|clothing|apparel|cotton|odysee|online/i.test(desc)) {
    return 'Shopping & Entertainment';
  }
  if (/pharmacy|hospital|asiri|nawaloka|lanka\s*hospital|durdan|health|medical|clinic|doctor/i.test(desc)) {
    return 'Health & Medical';
  }
  if (/stamp\s*duty|annual\s*fee|late\s*payment|finance\s*charge|interest|tax|vat|sscl|fee/i.test(desc)) {
    return 'Bank Fees & Taxes';
  }
  return 'Other Expenses';
}

/**
 * Parses raw text lines from a Commercial Bank credit card statement PDF.
 */
export function parseCombankStatement(
  lines: string[],
  cardId: string,
  cardLabel: string
): ParsedStatement {
  let billingDate = '';
  let dueDate = '';
  let totalOutstanding = 0;
  let minimumPaymentDue = 0;
  let creditLimit = 0;
  let availableCredit = 0;

  let openingBalance = 0;
  let totalPurchases = 0;
  let totalPayments = 0;
  let closingBalance = 0;

  let annualInterestRate: number | undefined;
  let monthlyInterestRate: number | undefined;

  const rawTxns: StatementTransaction[] = [];

  // 1. Extract Header & Key Summary Fields
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Billing Date / Statement Date (e.g. 14/08/2026 or 14-AUG-2026)
    if (!billingDate) {
      const match = line.match(/(?:billing|statement)\s*date[:\s]+([0-9]{2}[/-][0-9]{2}[/-][0-9]{4}|[0-9]{2}-[A-Za-z]{3}-[0-9]{4})/i);
      if (match) billingDate = match[1];
    }

    // Payment Due Date (e.g. 04/09/2026)
    if (!dueDate) {
      const match = line.match(/(?:payment\s*due\s*date|due\s*date)[:\s]+([0-9]{2}[/-][0-9]{2}[/-][0-9]{4}|[0-9]{2}-[A-Za-z]{3}-[0-9]{4})/i);
      if (match) dueDate = match[1];
    }

    // Total Outstanding / Total Amount Due / Closing Balance
    if (!totalOutstanding) {
      const match = line.match(/(?:total\s*outstanding|total\s*amount\s*due|new\s*balance|closing\s*balance)[:\s]+(?:LKR|Rs\.?)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);
      if (match) {
        const parsed = parseAmount(match[1]);
        if (parsed) totalOutstanding = parsed.amount;
      }
    }

    // Minimum Payment Due
    if (!minimumPaymentDue) {
      const match = line.match(/(?:minimum\s*payment\s*due|minimum\s*amount\s*due|minimum\s*payment)[:\s]+(?:LKR|Rs\.?)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);
      if (match) {
        const parsed = parseAmount(match[1]);
        if (parsed) minimumPaymentDue = parsed.amount;
      }
    }

    // Credit Limit
    if (!creditLimit) {
      const match = line.match(/(?:credit\s*limit)[:\s]+(?:LKR|Rs\.?)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);
      if (match) {
        const parsed = parseAmount(match[1]);
        if (parsed) creditLimit = parsed.amount;
      }
    }

    // Available Credit / Available Limit
    if (!availableCredit) {
      const match = line.match(/(?:available\s*(?:credit|limit))[:\s]+(?:LKR|Rs\.?)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);
      if (match) {
        const parsed = parseAmount(match[1]);
        if (parsed) availableCredit = parsed.amount;
      }
    }

    // Opening Balance / Previous Balance
    if (!openingBalance) {
      const match = line.match(/(?:opening\s*balance|previous\s*balance)[:\s]+(?:LKR|Rs\.?)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?(?:\s*CR)?)/i);
      if (match) {
        const parsed = parseAmount(match[1]);
        if (parsed) openingBalance = parsed.isCredit ? -parsed.amount : parsed.amount;
      }
    }

    // Total Purchases / Debits
    if (!totalPurchases) {
      const match = line.match(/(?:purchases(?:\s*&\s*other\s*debits)?|total\s*debits)[:\s]+(?:LKR|Rs\.?)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);
      if (match) {
        const parsed = parseAmount(match[1]);
        if (parsed) totalPurchases = parsed.amount;
      }
    }

    // Total Payments / Credits
    if (!totalPayments) {
      const match = line.match(/(?:payments(?:\s*&\s*other\s*credits)?|total\s*credits)[:\s]+(?:LKR|Rs\.?)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/i);
      if (match) {
        const parsed = parseAmount(match[1]);
        if (parsed) totalPayments = parsed.amount;
      }
    }

    // Interest Rates
    if (!annualInterestRate) {
      const match = line.match(/(?:annual\s*interest\s*rate|apr)[:\s]+([0-9]+(?:\.[0-9]+)?)\s*%/i);
      if (match) annualInterestRate = parseFloat(match[1]);
    }
    if (!monthlyInterestRate) {
      const match = line.match(/(?:monthly\s*interest\s*rate)[:\s]+([0-9]+(?:\.[0-9]+)?)\s*%/i);
      if (match) monthlyInterestRate = parseFloat(match[1]);
    }
  }

  // 2. Transaction Extraction Pattern
  // Combank transactions table columns: Processed Date, Transaction Date, Description, Amount (optional CR)
  // Example lines:
  // "14/08/2026 12/08/2026 KEELLS SUPER BATTARAMULLA 3,450.00"
  // "14/08/2026 14/08/2026 COMMERCIAL BANK ONLINE PAYMENT 50,000.00 CR"
  // "08/08/2026 07/08/2026 FLEXIPLAN SINGER 04 OF 12 8,250.00"
  const datePattern = '(?:[0-9]{2}[/-][0-9]{2}(?:[/-][0-9]{4}|[/-][0-9]{2})?|[0-9]{2}-[A-Za-z]{3}(?:-[0-9]{4}|-[0-9]{2})?)';
  const rowRegex = new RegExp(
    `^(${datePattern})\\s+(${datePattern})\\s+(.+?)\\s+([0-9]{1,3}(?:,[0-9]{3})*\\.[0-9]{2}(?:\\s*CR)?)$`,
    'i'
  );

  let inTxnSection = false;
  let txnIndex = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Table header detection
    if (/processed\s*date/i.test(line) && /transaction\s*date/i.test(line)) {
      inTxnSection = true;
      continue;
    }

    // Stop words that indicate end of transaction table
    if (inTxnSection && (
      /^total\s*(?:outstanding|amount\s*due)/i.test(line) ||
      /reward\s*points/i.test(line) ||
      /important\s*notice/i.test(line) ||
      /page\s+\d+\s+of\s+\d+/i.test(line)
    )) {
      if (/page\s+\d+\s+of\s+\d+/i.test(line)) continue;
    }

    const match = line.match(rowRegex);
    if (match) {
      const procDate = match[1];
      const txnDate = match[2];
      const desc = match[3].trim();
      const amountStr = match[4].trim();

      const parsedAmt = parseAmount(amountStr);
      if (parsedAmt && parsedAmt.amount > 0) {
        rawTxns.push({
          id: `stxn-${Date.now()}-${txnIndex++}`,
          processedDate: procDate,
          transactionDate: txnDate,
          description: desc,
          amount: parsedAmt.amount,
          isCredit: parsedAmt.isCredit,
          category: inferCategory(desc, parsedAmt.isCredit),
        });
      }
    }
  }

  // 3. Fallback / Sum verification if reconciliation numbers were missing from labeled boxes
  if (rawTxns.length > 0) {
    if (totalPurchases === 0) {
      totalPurchases = rawTxns
        .filter(t => !t.isCredit)
        .reduce((sum, t) => sum + t.amount, 0);
    }
    if (totalPayments === 0) {
      totalPayments = rawTxns
        .filter(t => t.isCredit)
        .reduce((sum, t) => sum + t.amount, 0);
    }
  }

  closingBalance = totalOutstanding || (openingBalance + totalPurchases - totalPayments);
  if (!totalOutstanding) totalOutstanding = closingBalance;

  // Math reconciliation check: opening + purchases - payments ≈ closing
  const mathClosing = openingBalance + totalPurchases - totalPayments;
  const isReconciled = Math.abs(mathClosing - closingBalance) < 1.0;

  // 4. Installment Plan Detection
  // Detect "FLEXIPLAN [NAME] XX of YY" or similar patterns
  const installmentMap = new Map<string, StatementInstallmentPlan>();
  const flexiRegex = /(?:flexiplan|0%\s*ip|installment(?:\s*plan)?)\s+(.+?)\s+(\d{1,2})\s*(?:of|\/)\s*(\d{1,2})/i;

  for (const t of rawTxns) {
    const match = t.description.match(flexiRegex);
    if (match) {
      const rawLabel = match[1].trim();
      const cur = parseInt(match[2], 10);
      const tot = parseInt(match[3], 10);
      const planKey = `${rawLabel.toLowerCase()}-${tot}`;

      const existing = installmentMap.get(planKey);
      if (existing) {
        existing.cycleAmount += t.amount;
        existing.rawDescriptions.push(t.description);
        existing.estimatedRemainingBalance = existing.cycleAmount * Math.max(0, existing.totalInstallments - existing.currentInstallment);
      } else {
        const remainingMonths = Math.max(0, tot - cur);
        installmentMap.set(planKey, {
          id: `plan-${Date.now()}-${planKey}`,
          label: rawLabel.toUpperCase(),
          currentInstallment: cur,
          totalInstallments: tot,
          cycleAmount: t.amount,
          estimatedRemainingBalance: t.amount * remainingMonths,
          rawDescriptions: [t.description],
        });
      }
    }
  }

  // Calculate days until due
  let daysUntilDue: number | undefined;
  if (dueDate) {
    try {
      let parsedDueDate: Date | null = null;
      if (dueDate.includes('/')) {
        parsedDueDate = parse(dueDate, 'dd/MM/yyyy', new Date());
      } else if (dueDate.includes('-')) {
        parsedDueDate = parse(dueDate, 'dd-MMM-yyyy', new Date());
      }
      if (parsedDueDate && !isNaN(parsedDueDate.getTime())) {
        daysUntilDue = differenceInCalendarDays(parsedDueDate, new Date());
      }
    } catch {
      // Ignored
    }
  }

  // Derive statement period e.g. "2026-08" from billing date or current date
  let statementPeriod = new Date().toISOString().substring(0, 7);
  if (billingDate) {
    const parts = billingDate.split(/[/ -]/);
    if (parts.length === 3) {
      if (parts[2].length === 4) {
        statementPeriod = `${parts[2]}-${parts[1].padStart(2, '0')}`;
      }
    }
  }

  const now = Date.now();
  return {
    id: `stmt-${cardId}-${statementPeriod}-${now}`,
    cardId,
    cardLabel,
    statementPeriod,
    billingDate: billingDate || 'N/A',
    dueDate: dueDate || 'N/A',
    daysUntilDue,
    totalOutstanding,
    minimumPaymentDue,
    creditLimit,
    availableCredit: availableCredit || (creditLimit > 0 ? Math.max(0, creditLimit - totalOutstanding) : 0),
    openingBalance,
    totalPurchases,
    totalPayments,
    closingBalance,
    isReconciled,
    annualInterestRate,
    monthlyInterestRate,
    transactions: rawTxns,
    installmentPlans: Array.from(installmentMap.values()),
    createdAt: now,
    updatedAt: now,
  };
}
