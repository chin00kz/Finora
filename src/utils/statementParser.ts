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
 * Normalizes date strings formatted as DD/MM/YY, DD/MM/YYYY, or DD-MMM-YYYY to DD/MM/YYYY.
 */
export function normalizeStatementDate(raw: string): string {
  if (!raw) return '';
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const day = slashMatch[1].padStart(2, '0');
    const month = slashMatch[2].padStart(2, '0');
    let year = slashMatch[3];
    if (year.length === 2) {
      year = `20${year}`;
    }
    return `${day}/${month}/${year}`;
  }
  return raw;
}

/**
 * Extracts raw lines from PDF file in client browser with column-aware coordinate preservation.
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

  function groupItemsIntoLines(items: ExtractedTextItem[]): string[] {
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: ExtractedTextItem[][] = [];
    let currentLine: ExtractedTextItem[] = [];
    let currentY: number | null = null;

    for (const item of items) {
      if (currentY === null || Math.abs(item.y - currentY) < 3.5) {
        currentLine.push(item);
        currentY = item.y;
      } else {
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

    return lines
      .map(line => line.map(i => i.str.trim()).join(' '))
      .filter(lineStr => lineStr.length > 0);
  }

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

    // Skip back-page terms & conditions (typically page 5 with 'Direct Debit Instructions' or 'Method of Payment')
    const isTermsPage = items.some(i => /Direct Debit Instructions|Method of Payment|fl;lzj;jpw;F/i.test(i.str));
    if (isTermsPage) {
      continue;
    }

    // Check if page has a 2-column layout (typical Combank statements where the summary column is placed at x >= 460)
    const hasRightSidebar = items.some(i => i.x >= 460) && items.some(i => i.x < 460);
    if (hasRightSidebar) {
      const leftItems = items.filter(i => i.x < 460);
      const rightItems = items.filter(i => i.x >= 460);
      allLines.push(...groupItemsIntoLines(leftItems));
      allLines.push(...groupItemsIntoLines(rightItems));
    } else {
      allLines.push(...groupItemsIntoLines(items));
    }
  }

  return allLines;
}

/**
 * Parses numeric string formatted as "12,345.67" or "12345.67" or "12,345.67 CR"
 */
function parseAmount(str: string): { amount: number; isCredit: boolean } | null {
  if (!str) return null;
  const s = str.trim();
  if (s.includes('/') || s.includes('-20') || /\*{2,}/.test(s) || /CARD|SUBTOTAL|POINTS|PAGE|STATEMENT/i.test(s)) return null;
  const match = s.match(/^(?:LKR|Rs\.?)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2}))(?:\s*CR)?$/i);
  if (!match) return null;
  const isCredit = /CR\b/i.test(s);
  const val = parseFloat(match[1].replace(/,/g, ''));
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
  if (/uber\s*eats|pickme\s*food|pizza|mcdonald|kfc|restaurant|cafe|burger|bakers|coffee|barista|breadtalk|pastry|dining|food|bake\s*house/i.test(desc)) {
    return 'Food & Dining';
  }
  if (/uber\s*trip|pickme|fuel|petrol|ceypetco|ioc|lafs|filling\s*station|parking|transport|highway|ride|petroleum/i.test(desc)) {
    return 'Transport & Fuel';
  }
  if (/ceb|leco|water\s*board|telecom|dialog|mobitel|slt|airtel|hutch|insurance|utility|electric|bill-pay/i.test(desc)) {
    return 'Bills & Utilities';
  }
  if (/daraz|amazon|aliexpress|ebay|apple|google|netflix|spotify|fashion|clothing|apparel|cotton|odysee|online|stores/i.test(desc)) {
    return 'Shopping & Entertainment';
  }
  if (/pharmacy|hospital|asiri|nawaloka|lanka\s*hospital|durdan|health|medical|clinic|doctor|drug\s*stores/i.test(desc)) {
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

  let cardNumberMasked: string | undefined;
  let cardType: string | undefined;
  let cardholderName: string | undefined;
  let rewardsPoints: number | undefined;

  const rawTxns: StatementTransaction[] = [];

  // 1. Extract Header & Key Summary Fields
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Card Number e.g. "4378 4002 **** 6135" or "43784002****6135"
    if (!cardNumberMasked) {
      const match = line.match(/\b([0-9]{4}\s+[0-9]{4}\s+\*{4}\s+[0-9]{4})\b/)
        || line.match(/\b([0-9]{4}\s*\*{4,8}\s*[0-9]{4})\b/);
      if (match) cardNumberMasked = match[1].replace(/\s+/g, ' ');
    }

    // Card Type e.g. "Visa Platinum", "MasterCard Gold"
    if (!cardType) {
      const match = line.match(/\b(Visa|MasterCard)\s+(Platinum|Gold|Classic|Signature|Infinite|Corporate)\b/i);
      if (match) cardType = match[0];
    }

    // Cardholder Name
    if (!cardholderName) {
      const match = line.match(/^([A-Z\s]{3,30})\s+(?:Visa|MasterCard)/i);
      if (match) cardholderName = match[1].trim();
    }

    // Interest Rates (guard so we capture the primary card rates)
    if (annualInterestRate === undefined) {
      const match = line.match(/(?:annual\s*interest\s*rate|apr)[:\s]+([0-9]+(?:\.[0-9]+)?)\s*%/i)
        || line.match(/([0-9]+(?:\.[0-9]+)?)\s*%\s+([0-9]+(?:\.[0-9]+)?)\s*%/);
      if (match) {
        annualInterestRate = parseFloat(match[1]);
        if (match[2]) {
          monthlyInterestRate = parseFloat(match[2]);
        }
      }
    }
    if (monthlyInterestRate === undefined) {
      const match = line.match(/(?:monthly\s*interest\s*rate)[:\s]+([0-9]+(?:\.[0-9]+)?)\s*%/i);
      if (match) monthlyInterestRate = parseFloat(match[1]);
    }

    // Loyalty Points Balance
    if (rewardsPoints === undefined) {
      const match = line.match(/(?:MAX\s*REWARDS\s*TOTAL\s*POINTS\s*BALANCE|TOTAL\s*POINTS\s*BALANCE|REWARDS?\s*POINTS?)[:\s]*([0-9]+)/i);
      if (match) rewardsPoints = parseInt(match[1], 10);
    }

    // Billing Date / Statement Date (e.g. 05/09/26, 05/09/2026 or 14-AUG-2026)
    if (!billingDate) {
      const match = line.match(/(?:billing|statement)\s*date[:\s]+([0-9]{2}[/-][0-9]{2}[/-][0-9]{2,4}|[0-9]{2}-[A-Za-z]{3}-[0-9]{2,4})/i);
      if (match) billingDate = normalizeStatementDate(match[1]);
    }

    // Payment Due Date (e.g. 28/09/26, 28/09/2026)
    if (!dueDate) {
      const match = line.match(/(?:payment\s*due\s*date|due\s*date)[:\s]+([0-9]{2}[/-][0-9]{2}[/-][0-9]{2,4}|[0-9]{2}-[A-Za-z]{3}-[0-9]{2,4})/i);
      if (match) dueDate = normalizeStatementDate(match[1]);
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
      const match = line.match(/(?:opening\s*balance|previous\s*balance)[:\s]+(?:LKR|Rs\.?)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?(?:\s*CR)?)/i)
        || line.match(/^OPENING\s*BALANCE\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?(?:\s*CR)?)$/i);
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
  }

  // Fallback date extraction if unlabeled in right sidebar
  if (!billingDate || !dueDate) {
    const dateRegex = /\b([0-9]{2}\/[0-9]{2}\/[0-9]{2,4})\b/;
    for (const line of lines) {
      const m = line.match(dateRegex);
      if (m) {
        const norm = normalizeStatementDate(m[1]);
        if (!billingDate) {
          billingDate = norm;
        } else if (!dueDate && norm !== billingDate) {
          dueDate = norm;
        }
      }
    }
  }

  // Determine billing year & month to resolve DD/MM transaction dates
  let billingYear = new Date().getFullYear();
  let billingMonth = new Date().getMonth() + 1;
  if (billingDate) {
    const parts = billingDate.split(/[/ -]/);
    if (parts.length === 3) {
      billingMonth = parseInt(parts[1], 10) || billingMonth;
      billingYear = parseInt(parts[2], 10) || billingYear;
    }
  }

  // 2. Transaction Extraction Pattern
  // Combank transactions table columns: Processed Date, Transaction Date, Description, Amount (optional CR)
  // Supports DD/MM and DD/MM/YYYY
  const datePattern = '(?:[0-9]{2}/[0-9]{2}(?:/[0-9]{2,4})?|[0-9]{2}-[A-Za-z]{3}(?:-[0-9]{2,4})?)';
  const rowRegex = new RegExp(
    `^(${datePattern})\\s+(${datePattern})\\s+(.+?)\\s+([0-9]{1,3}(?:,[0-9]{3})*\\.[0-9]{2}(?:\\s*CR)?)$`,
    'i'
  );

  let txnIndex = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.includes('OPENING BALANCE')) continue;
    if (line.includes('SUBTOTAL')) continue;
    if (/^Page\s+\d+\s+of\s+\d+/i.test(line)) continue;
    if (/COMBANK\s+MAX\s+LOYALTY/i.test(line)) continue;
    if (/THE\s+STATED\s+MAX\s+LOYALTY/i.test(line)) continue;

    const match = line.match(rowRegex);
    if (match) {
      const procDate = match[1];
      const txnDate = match[2];
      const desc = match[3].trim();
      const amountStr = match[4].trim();

      const parsedAmt = parseAmount(amountStr);
      if (parsedAmt && parsedAmt.amount > 0) {
        // Expand DD/MM to DD/MM/YYYY if year was omitted
        let formattedTxnDate = txnDate;
        let formattedProcDate = procDate;

        if (txnDate.split('/').length === 2 && billingYear) {
          const [tDay, tMonth] = txnDate.split('/').map(x => parseInt(x, 10));
          const tYear = (billingMonth && tMonth > billingMonth) ? (billingYear - 1) : billingYear;
          formattedTxnDate = `${String(tDay).padStart(2, '0')}/${String(tMonth).padStart(2, '0')}/${tYear}`;
        }
        if (procDate.split('/').length === 2 && billingYear) {
          const [pDay, pMonth] = procDate.split('/').map(x => parseInt(x, 10));
          const pYear = (billingMonth && pMonth > billingMonth) ? (billingYear - 1) : billingYear;
          formattedProcDate = `${String(pDay).padStart(2, '0')}/${String(pMonth).padStart(2, '0')}/${pYear}`;
        }

        rawTxns.push({
          id: `stxn-${Date.now()}-${txnIndex++}`,
          processedDate: formattedProcDate,
          transactionDate: formattedTxnDate,
          description: desc,
          amount: parsedAmt.amount,
          isCredit: parsedAmt.isCredit,
          category: inferCategory(desc, parsedAmt.isCredit),
        });
      }
    }
  }

  // 3. Fallback / Sum calculation
  const standaloneAmounts: number[] = [];
  for (const l of lines) {
    const p = parseAmount(l);
    if (p && !p.isCredit && p.amount > 0) {
      standaloneAmounts.push(p.amount);
    }
  }

  // Populate from Combank right-column sequence if unlabeled
  if (!totalOutstanding && standaloneAmounts.length > 0) {
    totalOutstanding = standaloneAmounts[0];
  }
  if (!minimumPaymentDue && standaloneAmounts.length > 1) {
    minimumPaymentDue = standaloneAmounts[1];
  }
  if (!creditLimit && standaloneAmounts.length > 2) {
    creditLimit = standaloneAmounts[2];
  }
  if (!openingBalance && standaloneAmounts.length > 3) {
    openingBalance = standaloneAmounts[3];
  }
  if (!totalPurchases && standaloneAmounts.length > 4) {
    totalPurchases = standaloneAmounts[4];
  }

  if (rawTxns.length > 0) {
    const sumPurchases = rawTxns
      .filter(t => !t.isCredit)
      .reduce((sum, t) => sum + t.amount, 0);
    const sumPayments = rawTxns
      .filter(t => t.isCredit)
      .reduce((sum, t) => sum + t.amount, 0);

    if (totalPurchases === 0) {
      totalPurchases = Math.round(sumPurchases * 100) / 100;
    }
    if (totalPayments === 0) {
      totalPayments = Math.round(sumPayments * 100) / 100;
    }
  }

  closingBalance = totalOutstanding || Math.round((openingBalance + totalPurchases - totalPayments) * 100) / 100;
  if (!totalOutstanding) totalOutstanding = closingBalance;
  if (!minimumPaymentDue) {
    minimumPaymentDue = Math.round(totalOutstanding * 0.04 * 100) / 100;
  }

  // Fallback credit limit search if unlabeled (e.g. 420,000.00 standalone)
  if (!creditLimit) {
    const maxCandidate = Math.max(...standaloneAmounts.filter(a => a >= 50000 && a !== closingBalance && a !== totalPurchases && a !== openingBalance), 0);
    if (maxCandidate > 0) creditLimit = maxCandidate;
  }

  // Math reconciliation check: opening + purchases - payments ≈ closing
  const mathClosing = openingBalance + totalPurchases - totalPayments;
  const isReconciled = Math.abs(mathClosing - closingBalance) < 1.0;

  // 4. Installment Plan Detection
  // Matches "FLEXIPLAN [NAME] NNN of MMM" with 1 to 3 digits (e.g. 003 of 012, 009 of 024)
  const installmentMap = new Map<string, StatementInstallmentPlan>();
  const flexiRegex = /(?:flexiplan|0%\s*ip|installment(?:\s*plan)?)\s+([A-Za-z0-9\s\-_]+?)\s+(\d{1,3})\s*(?:of|\/)\s*(\d{1,3})/i;

  for (const t of rawTxns) {
    const match = t.description.match(flexiRegex);
    if (match) {
      const rawLabel = match[1].trim().toUpperCase();
      const cur = parseInt(match[2], 10);
      const tot = parseInt(match[3], 10);
      // Key by label, total months, and monthly amount to distinguish multiple concurrent plans
      const planKey = `${rawLabel}-${tot}-${t.amount.toFixed(2)}`;

      const existing = installmentMap.get(planKey);
      if (existing) {
        existing.rawDescriptions.push(t.description);
      } else {
        const remainingMonths = Math.max(0, tot - cur);
        installmentMap.set(planKey, {
          id: `plan-${Date.now()}-${planKey}`,
          label: `FLEXIPLAN ${rawLabel}`,
          currentInstallment: cur,
          totalInstallments: tot,
          cycleAmount: t.amount,
          estimatedRemainingBalance: Math.round(t.amount * remainingMonths * 100) / 100,
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
      const y = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      statementPeriod = `${y}-${parts[1].padStart(2, '0')}`;
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
    cardNumberMasked,
    cardType,
    cardholderName,
    rewardsPoints,
    transactions: rawTxns,
    installmentPlans: Array.from(installmentMap.values()),
    createdAt: now,
    updatedAt: now,
  };
}
