import { format } from 'date-fns';
import type { Transaction, Category, Account, Tag } from '../db/db';

/**
 * Escapes a field for CSV according to RFC 4180.
 */
function escapeCSV(field: unknown): string {
  if (field === null || field === undefined) return '""';
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * Exports transactions to CSV and triggers instant browser download.
 */
export function exportPeriodCSV({
  transactions,
  categories,
  accounts,
  tags,
  periodName = 'export',
}: {
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  tags: Tag[];
  periodName?: string;
}) {
  const catMap = new Map(categories.map(c => [c.id, c.name]));
  const accMap = new Map(accounts.map(a => [a.id, a.name]));
  const tagMap = new Map(tags.map(t => [t.id, t.name]));

  const headers = [
    'Date',
    'Time',
    'Type',
    'Amount (LKR)',
    'Category',
    'Account',
    'Tags',
    'Notes',
    'Out of Budget',
  ];

  const rows = transactions.map(t => {
    const d = new Date(t.date);
    const dateStr = format(d, 'yyyy-MM-dd');
    const timeStr = format(d, 'h:mm a');
    const catName = t.categoryId ? catMap.get(t.categoryId) || 'Uncategorized' : 'None';
    const accName = accMap.get(t.accountId) || 'Unknown';
    const tagNames = (t.tagIds || []).map(id => tagMap.get(id) || id).join('; ');

    return [
      escapeCSV(dateStr),
      escapeCSV(timeStr),
      escapeCSV(t.type),
      escapeCSV(t.amount),
      escapeCSV(catName),
      escapeCSV(accName),
      escapeCSV(tagNames),
      escapeCSV(t.notes || ''),
      escapeCSV(t.excludeFromBudget ? 'Yes' : 'No'),
    ].join(',');
  });

  const csvContent = '\uFEFF' + [headers.map(escapeCSV).join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName = periodName.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  link.setAttribute('href', url);
  link.setAttribute('download', `finora_report_${safeName}_${format(new Date(), 'yyyyMMdd')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface PrintableReportData {
  title: string;
  periodLabel: string;
  dateRange: string;
  currency?: string;
  totalExpense: number;
  totalIncome: number;
  budgetAmount?: number;
  remainingBudget?: number;
  isOverspent?: boolean;
  categoryBreakdown: {
    name: string;
    amount: number;
    percent: number;
    color?: string;
  }[];
  transactions: {
    date: number;
    type: string;
    categoryName: string;
    accountName: string;
    amount: number;
    notes?: string;
  }[];
}

/**
 * Opens a beautifully formatted printable window and prompts window.print() for PDF export.
 */
export function printPeriodReport(data: PrintableReportData) {
  const currency = data.currency || 'LKR';
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Please allow popups to generate the printable PDF report.');
    return;
  }

  const catRows = data.categoryBreakdown
    .map(
      c => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb;">
        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${c.color || '#64748b'}; margin-right:8px;"></span>
        ${c.name}
      </td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 500;">
        ${currency} ${c.amount.toLocaleString()}
      </td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #6b7280;">
        ${c.percent}%
      </td>
    </tr>
  `
    )
    .join('');

  const txnRows = data.transactions
    .slice(0, 100) // Cap printable detail at 100 rows for clean PDF paging
    .map(
      t => `
    <tr>
      <td style="padding: 6px 12px; border-bottom: 1px solid #f3f4f6; font-size: 12px; color: #6b7280;">
        ${format(new Date(t.date), 'MMM dd, yyyy h:mm a')}
      </td>
      <td style="padding: 6px 12px; border-bottom: 1px solid #f3f4f6; font-size: 12px; font-weight: 500;">
        ${t.notes || t.categoryName || t.type}
      </td>
      <td style="padding: 6px 12px; border-bottom: 1px solid #f3f4f6; font-size: 12px; color: #4b5563;">
        ${t.categoryName}
      </td>
      <td style="padding: 6px 12px; border-bottom: 1px solid #f3f4f6; font-size: 12px; color: #4b5563;">
        ${t.accountName}
      </td>
      <td style="padding: 6px 12px; border-bottom: 1px solid #f3f4f6; font-size: 12px; text-align: right; font-weight: 600; color: ${t.type === 'expense' ? '#111827' : '#16a34a'};">
        ${t.type === 'expense' ? '-' : '+'}${currency} ${t.amount.toLocaleString()}
      </td>
    </tr>
  `
    )
    .join('');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${data.title} - ${data.periodLabel}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #111827;
      margin: 0;
      padding: 32px;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 20px;
      border-bottom: 2px solid #111827;
      margin-bottom: 24px;
    }
    .logo {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 28px;
    }
    .stat-card {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 16px;
    }
    .stat-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #6b7280;
      margin-bottom: 4px;
    }
    .stat-value {
      font-size: 22px;
      font-weight: 600;
      color: #111827;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 28px;
    }
    th {
      text-align: left;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #6b7280;
      padding: 8px 12px;
      border-bottom: 2px solid #e5e7eb;
    }
    h2 {
      font-size: 15px;
      font-weight: 600;
      margin-bottom: 12px;
      color: #111827;
    }
    .footer {
      font-size: 11px;
      color: #9ca3af;
      text-align: center;
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
    }
    @media print {
      body { padding: 16px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">Finora</div>
      <div style="font-size: 14px; color: #4b5563; margin-top: 4px;">${data.title} &middot; ${data.periodLabel}</div>
    </div>
    <div style="text-align: right;">
      <div style="font-size: 12px; font-weight: 500; color: #6b7280;">Date Range</div>
      <div style="font-size: 13px; font-weight: 600; color: #111827;">${data.dateRange}</div>
      <div style="font-size: 11px; color: #9ca3af; margin-top: 2px;">Generated: ${format(new Date(), 'MMM dd, yyyy h:mm a')}</div>
    </div>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-label">Total Spent</div>
      <div class="stat-value">${currency} ${data.totalExpense.toLocaleString()}</div>
    </div>
    ${
      data.budgetAmount !== undefined
        ? `
    <div class="stat-card">
      <div class="stat-label">Budget Limit</div>
      <div class="stat-value">${currency} ${data.budgetAmount.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">${data.isOverspent ? 'Over Budget' : 'Remaining Budget'}</div>
      <div class="stat-value" style="color: ${data.isOverspent ? '#dc2626' : '#16a34a'};">
        ${currency} ${(data.remainingBudget ?? 0).toLocaleString()}
      </div>
    </div>
    `
        : `
    <div class="stat-card">
      <div class="stat-label">Total Income</div>
      <div class="stat-value" style="color: #16a34a;">${currency} ${data.totalIncome.toLocaleString()}</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Net Savings</div>
      <div class="stat-value" style="color: ${data.totalIncome - data.totalExpense >= 0 ? '#16a34a' : '#dc2626'};">
        ${currency} ${(data.totalIncome - data.totalExpense).toLocaleString()}
      </div>
    </div>
    `
    }
  </div>

  ${
    data.categoryBreakdown.length > 0
      ? `
  <h2>Spending by Category</h2>
  <table>
    <thead>
      <tr>
        <th>Category</th>
        <th style="text-align: right;">Amount</th>
        <th style="text-align: right;">% of Total</th>
      </tr>
    </thead>
    <tbody>
      ${catRows}
    </tbody>
  </table>
  `
      : ''
  }

  <h2>Transactions List (${data.transactions.length})</h2>
  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Description</th>
        <th>Category</th>
        <th>Account</th>
        <th style="text-align: right;">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${txnRows}
    </tbody>
  </table>

  <div class="footer">
    Finora &middot; Minimal Budget & Expense Tracker &middot; Page 1
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 250);
    };
  </script>
</body>
</html>
  `;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

