import { ArrowLeft } from 'lucide-react'

interface BackButtonProps {
  onClick: () => void
  label?: string
}

export function BackButton({ onClick, label = "Back" }: BackButtonProps) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 bg-white hover:bg-rose-50 text-gray-700 hover:text-rose-700 font-semibold px-4 py-2 rounded-xl text-xs shadow-xs border border-rose-100 transition mb-6 group"
    >
      <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
      <span>{label}</span>
    </button>
  )
}
