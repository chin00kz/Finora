import { useState, useRef } from 'react';
import {
  X,
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  FolderPlus,
  Tag as TagIcon,
  CreditCard,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { analyzeCSV, executeImport } from '../utils/csvImporter';
import type { CSVAnalysis } from '../utils/csvImporter';
import { format } from 'date-fns';

interface ImportDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function ImportDataModal({ isOpen, onClose, onSuccess }: ImportDataModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string>('');
  const [analysis, setAnalysis] = useState<CSVAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [adjustBalances, setAdjustBalances] = useState(true);
  const [importResult, setImportResult] = useState<{
    importedTransactionsCount: number;
    createdAccountsCount: number;
    createdCategoriesCount: number;
    createdTagsCount: number;
  } | null>(null);

  if (!isOpen) return null;

  const resetState = () => {
    setFileName('');
    setAnalysis(null);
    setError(null);
    setIsAnalyzing(false);
    setIsImporting(false);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setAnalysis(null);
    setImportResult(null);
    setIsAnalyzing(true);

    try {
      const text = await file.text();
      const parsedAnalysis = await analyzeCSV(text);
      if (parsedAnalysis.validRows.length === 0) {
        setError('No valid transactions could be found in this CSV file.');
      } else {
        setAnalysis(parsedAnalysis);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV file.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setAnalysis(null);
    setImportResult(null);
    setIsAnalyzing(true);

    try {
      const text = await file.text();
      const parsedAnalysis = await analyzeCSV(text);
      if (parsedAnalysis.validRows.length === 0) {
        setError('No valid transactions could be found in this CSV file.');
      } else {
        setAnalysis(parsedAnalysis);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV file.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleStartImport = async () => {
    if (!analysis) return;
    setIsImporting(true);
    setError(null);

    try {
      const result = await executeImport(analysis, { adjustBalances });
      setImportResult(result);
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={handleClose}
    >
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-5 animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-accent/15 text-accent flex items-center justify-center">
              <UploadCloud size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Import CSV Data</h2>
              <p className="text-xs text-muted-foreground">Restore or import transactions, categories & accounts</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Success State */}
        {importResult ? (
          <div className="py-6 text-center space-y-4">
            <div className="w-14 h-14 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 size={32} />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-foreground">Import Completed Successfully!</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Your transactions and financial accounts have been restored and synced to the cloud.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 max-w-md mx-auto text-left">
              <div className="p-3 bg-muted/50 border border-border rounded-xl">
                <p className="text-[10px] uppercase font-semibold text-muted-foreground">Transactions</p>
                <p className="text-lg font-semibold text-foreground">{importResult.importedTransactionsCount}</p>
              </div>
              <div className="p-3 bg-muted/50 border border-border rounded-xl">
                <p className="text-[10px] uppercase font-semibold text-muted-foreground">Accounts</p>
                <p className="text-lg font-semibold text-foreground">{importResult.createdAccountsCount}</p>
              </div>
              <div className="p-3 bg-muted/50 border border-border rounded-xl">
                <p className="text-[10px] uppercase font-semibold text-muted-foreground">Categories</p>
                <p className="text-lg font-semibold text-foreground">{importResult.createdCategoriesCount}</p>
              </div>
              <div className="p-3 bg-muted/50 border border-border rounded-xl">
                <p className="text-[10px] uppercase font-semibold text-muted-foreground">Tags</p>
                <p className="text-lg font-semibold text-foreground">{importResult.createdTagsCount}</p>
              </div>
            </div>

            <div className="pt-4 flex justify-center">
              <button
                onClick={handleClose}
                className="px-6 py-2.5 bg-foreground text-background rounded-xl text-xs font-semibold hover:opacity-90 active:scale-95 transition-all shadow-sm"
              >
                Done & View Activity
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* File Dropzone */}
            {!analysis && (
              <div
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border hover:border-foreground/40 rounded-2xl p-8 text-center cursor-pointer transition-all hover:bg-muted/30 group"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto text-muted-foreground group-hover:text-foreground group-hover:scale-110 transition-all mb-3">
                  <FileSpreadsheet size={24} />
                </div>
                <p className="text-sm font-medium text-foreground">Click to select CSV or drag & drop</p>
                <p className="text-xs text-muted-foreground mt-1">Supports Finora export files or standard CSVs</p>
              </div>
            )}

            {isAnalyzing && (
              <div className="py-8 text-center space-y-2">
                <RefreshCw size={24} className="animate-spin mx-auto text-muted-foreground" />
                <p className="text-xs text-muted-foreground font-medium">Analyzing CSV structure...</p>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="p-3.5 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl text-xs flex items-start gap-2.5">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            {/* Analysis & Preview */}
            {analysis && (
              <div className="space-y-4">
                {/* File summary pill */}
                <div className="flex items-center justify-between p-3 bg-muted/60 border border-border rounded-xl text-xs">
                  <div className="flex items-center gap-2 truncate">
                    <FileSpreadsheet size={16} className="text-muted-foreground shrink-0" />
                    <span className="font-medium text-foreground truncate">{fileName}</span>
                  </div>
                  <button
                    onClick={resetState}
                    className="text-xs text-muted-foreground hover:text-foreground underline shrink-0 ml-2"
                  >
                    Change file
                  </button>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 bg-card border border-border rounded-xl">
                    <p className="text-[10px] uppercase font-semibold text-muted-foreground">Transactions</p>
                    <p className="text-base font-semibold text-foreground">{analysis.validRows.length}</p>
                  </div>
                  <div className="p-3 bg-card border border-border rounded-xl">
                    <p className="text-[10px] uppercase font-semibold text-muted-foreground">Total Expenses</p>
                    <p className="text-base font-semibold text-red-500">
                      LKR {analysis.totalExpenseAmount.toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 bg-card border border-border rounded-xl">
                    <p className="text-[10px] uppercase font-semibold text-muted-foreground">Total Income</p>
                    <p className="text-base font-semibold text-emerald-500">
                      LKR {analysis.totalIncomeAmount.toLocaleString()}
                    </p>
                  </div>
                  <div className="p-3 bg-card border border-border rounded-xl">
                    <p className="text-[10px] uppercase font-semibold text-muted-foreground">New Accounts</p>
                    <p className="text-base font-semibold text-foreground">
                      {analysis.accountsToCreate.length}
                    </p>
                  </div>
                </div>

                {/* Auto-Creation Notice */}
                {(analysis.accountsToCreate.length > 0 || analysis.categoriesToCreate.length > 0) && (
                  <div className="p-3 bg-muted/40 border border-border rounded-xl text-xs space-y-1.5">
                    <p className="font-semibold text-foreground">Entities created automatically:</p>
                    {analysis.accountsToCreate.length > 0 && (
                      <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
                        <CreditCard size={12} className="text-accent shrink-0" />
                        <span>Accounts: {analysis.accountsToCreate.join(', ')}</span>
                      </div>
                    )}
                    {analysis.categoriesToCreate.length > 0 && (
                      <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
                        <FolderPlus size={12} className="text-accent shrink-0" />
                        <span>Categories: {analysis.categoriesToCreate.map(c => c.name).join(', ')}</span>
                      </div>
                    )}
                    {analysis.tagsToCreate.length > 0 && (
                      <div className="flex items-center gap-1.5 text-muted-foreground text-[11px]">
                        <TagIcon size={12} className="text-accent shrink-0" />
                        <span>Tags: {analysis.tagsToCreate.join(', ')}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Preview of first few rows */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Preview (First {Math.min(5, analysis.validRows.length)} rows)
                  </p>
                  <div className="border border-border rounded-xl overflow-hidden text-xs">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-muted/70 text-[11px] font-semibold text-muted-foreground border-b border-border">
                          <tr>
                            <th className="p-2 pl-3">Date</th>
                            <th className="p-2">Type</th>
                            <th className="p-2">Category</th>
                            <th className="p-2">Account</th>
                            <th className="p-2">Notes</th>
                            <th className="p-2 pr-3 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {analysis.validRows.slice(0, 5).map((row, idx) => (
                            <tr key={idx} className="hover:bg-muted/30">
                              <td className="p-2 pl-3 whitespace-nowrap text-muted-foreground">
                                {format(new Date(row.timestamp), 'yyyy-MM-dd')}
                              </td>
                              <td className="p-2 capitalize font-medium">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                                    row.type === 'expense'
                                      ? 'bg-red-500/10 text-red-500'
                                      : row.type === 'income'
                                      ? 'bg-emerald-500/10 text-emerald-500'
                                      : 'bg-muted text-muted-foreground'
                                  }`}
                                >
                                  {row.type}
                                </span>
                              </td>
                              <td className="p-2 text-foreground font-medium truncate max-w-[100px]">
                                {row.categoryName || '—'}
                              </td>
                              <td className="p-2 text-muted-foreground truncate max-w-[90px]">
                                {row.accountName}
                              </td>
                              <td className="p-2 text-muted-foreground truncate max-w-[120px]">
                                {row.notes || '—'}
                              </td>
                              <td className="p-2 pr-3 text-right font-medium text-foreground whitespace-nowrap">
                                LKR {row.amount.toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Option: Adjust Balances */}
                <label className="flex items-center gap-2.5 p-3 bg-muted/40 border border-border rounded-xl cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={adjustBalances}
                    onChange={e => setAdjustBalances(e.target.checked)}
                    className="rounded border-border text-accent focus:ring-accent w-4 h-4"
                  />
                  <div>
                    <span className="font-medium text-foreground">
                      Recalculate account balances from imported transactions
                    </span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Updates account balances based on net income and expenses in the file.
                    </p>
                  </div>
                </label>

                {/* Action Buttons */}
                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    onClick={handleClose}
                    disabled={isImporting}
                    className="px-4 py-2.5 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:text-foreground active:scale-95 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleStartImport}
                    disabled={isImporting}
                    className="flex items-center gap-2 px-5 py-2.5 bg-accent text-accent-foreground rounded-xl text-xs font-semibold hover:opacity-90 active:scale-95 transition-all shadow-sm disabled:opacity-60"
                  >
                    {isImporting ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        <span>Importing data...</span>
                      </>
                    ) : (
                      <>
                        <span>Import {analysis.validRows.length} Transactions</span>
                        <ArrowRight size={14} />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

