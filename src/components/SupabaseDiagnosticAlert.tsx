import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react'
import {
  PROFILE_MIGRATION_SQL,
  runSupabaseDiagnostics,
  type DiagnosticCheckItem,
  type SupabaseDiagnosticReport,
} from '@/lib/supabase/diagnostics'

interface SupabaseDiagnosticAlertProps {
  mode?: 'banner' | 'panel'
  triggerRefreshKey?: number
  hideWhenHealthy?: boolean
}

function StatusLabel({ status }: { status: DiagnosticCheckItem['status'] }) {
  if (status === 'pass') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 whitespace-nowrap shrink-0">
        <CheckCircle2 className="w-3.5 h-3.5" /> Connected
      </span>
    )
  }
  if (status === 'warning') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 whitespace-nowrap shrink-0">
        <AlertTriangle className="w-3.5 h-3.5" /> Warning
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 whitespace-nowrap shrink-0">
      <XCircle className="w-3.5 h-3.5" /> Action Needed
    </span>
  )
}

export function SupabaseDiagnosticAlert({
  mode = 'banner',
  triggerRefreshKey = 0,
  hideWhenHealthy = mode === 'banner',
}: SupabaseDiagnosticAlertProps) {
  const [report, setReport] = useState<SupabaseDiagnosticReport | null>(null)
  const [checking, setChecking] = useState(true)
  const [dismissed, setDismissed] = useState(false)
  const [showDetails, setShowDetails] = useState(mode === 'panel')
  const [copiedSql, setCopiedSql] = useState(false)

  const runCheck = useCallback(async () => {
    setChecking(true)
    try {
      const next = await runSupabaseDiagnostics()
      setReport(next)
      if (next.overallStatus !== 'healthy') {
        setDismissed(false)
      }
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void runCheck()
  }, [runCheck, triggerRefreshKey])

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(PROFILE_MIGRATION_SQL)
      setCopiedSql(true)
      setTimeout(() => setCopiedSql(false), 2500)
    } catch {
      setShowDetails(true)
    }
  }

  if (mode === 'banner') {
    if (checking && !report) return null
    if (!report) return null
    if (hideWhenHealthy && report.overallStatus === 'healthy') return null
    if (dismissed) return null

    const isError = report.overallStatus === 'error'
    const isProxyActive = !isError && report.serverProxyActive
    const surfaceClass = isError
      ? 'bg-red-50 border-b border-red-200 text-red-950'
      : isProxyActive
      ? 'bg-emerald-50 border-b border-emerald-200 text-emerald-950'
      : 'bg-amber-50 border-b border-amber-200 text-amber-950'

    return (
      <div role="alert" className={surfaceClass}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              {isError ? (
                <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              ) : isProxyActive ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              )}
              <div className="text-xs sm:text-sm min-w-0">
                <p className="font-semibold">
                  {report.headline}
                  <span className="font-normal text-gray-700"> — {report.summary}</span>
                </p>
                {report.actionHint && (
                  <p className="text-xs text-gray-600 mt-0.5">{report.actionHint}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {report.schemaMigrationNeeded && (
                <button
                  type="button"
                  onClick={handleCopySql}
                  className="px-3 py-1.5 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-gray-900 text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedSql ? 'Copied Fix SQL' : 'Copy Fix SQL'}
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowDetails((prev) => !prev)}
                className="px-3 py-1.5 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 text-xs font-semibold transition flex items-center gap-1 whitespace-nowrap shrink-0"
              >
                {showDetails ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5" /> Hide Checks
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" /> View Checks
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => void runCheck()}
                disabled={checking}
                className="px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
                {checking ? 'Checking...' : 'Re-check'}
              </button>

              <button
                type="button"
                onClick={() => setDismissed(true)}
                aria-label="Dismiss Supabase diagnostic alert"
                className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-black/5 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {showDetails && (
            <div className="mt-3 pt-3 border-t border-black/10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {report.checks.map((item) => (
                <div key={item.id} className="text-xs space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-gray-900">{item.label}</span>
                    <StatusLabel status={item.status} />
                  </div>
                  <p className="text-gray-600 leading-relaxed">{item.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Panel mode: full diagnostic card for Register / Admin / troubleshooting
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Database className="w-4 h-4 text-rose-700 shrink-0" />
          <div>
            <h3 className="text-sm font-bold text-gray-900">
              {checking && !report ? 'Checking Supabase Connection...' : report?.headline}
            </h3>
            {report && (
              <p className="text-xs text-gray-500 tabular-nums">
                {report.projectUrl} · Checked {report.checkedAt} · {report.latencyMs} ms
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {report?.schemaMigrationNeeded && (
            <button
              type="button"
              onClick={handleCopySql}
              className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Copy className="w-3.5 h-3.5" />
              {copiedSql ? 'Copied Fix SQL' : 'Copy Fix SQL'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void runCheck()}
            disabled={checking}
            className="px-3.5 py-1.5 rounded-xl bg-gray-900 hover:bg-black disabled:opacity-60 text-white text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Testing...' : 'Re-check Connection'}
          </button>
        </div>
      </div>

      {report && (
        <>
          <p
            className={`text-xs leading-relaxed ${
              report.overallStatus === 'error'
                ? 'text-red-700 font-medium'
                : report.overallStatus === 'warning'
                ? 'text-amber-800 font-medium'
                : 'text-emerald-700 font-medium'
            }`}
          >
            {report.summary}
            {report.actionHint ? ` ${report.actionHint}` : ''}
          </p>

          <div className="divide-y divide-gray-100 border-t border-gray-100">
            {report.checks.map((item) => (
              <div
                key={item.id}
                className="py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-gray-900">{item.label}</span>
                  <p className="text-gray-600 mt-0.5">{item.detail}</p>
                </div>
                <StatusLabel status={item.status} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
