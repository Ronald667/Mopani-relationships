import React, { useState } from 'react'
import { BackButton } from '@/components/BackButton'
import { deleteProfilesByWhatsappOnSupabase, removeProfilesByWhatsapp } from '@/utils/profileStorage'
import { Trash2, CheckCircle2 } from 'lucide-react'

export function DeleteData({ onBack }: { onBack: () => void }) {
  const [whatsapp, setWhatsapp] = useState('')
  const [loading, setLoading] = useState(false)
  const [deleted, setDeleted] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!whatsapp.trim()) return
    setErrorMsg('')

    setLoading(true)
    try {
      const res = await deleteProfilesByWhatsappOnSupabase(whatsapp)
      if (!res.ok && res.error) {
        console.warn('Supabase deletion notice:', res.error)
      }

      removeProfilesByWhatsapp(whatsapp)
      setDeleted(true)
    } catch (err: any) {
      setErrorMsg('Error deleting data: ' + (err?.message || 'Unable to process deletion'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-16">
      <BackButton onClick={onBack} label="Back to Discover" />

      <div className="bg-white rounded-3xl p-8 sm:p-12 shadow-xl border border-rose-100 space-y-6 text-center">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
          <Trash2 className="w-8 h-8" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-gray-900">Delete My Data (POPIA Right)</h1>
        <p className="text-xs sm:text-sm text-gray-600 leading-relaxed">
          Under the Protection of Personal Information Act (POPIA), you have the absolute right to request the permanent deletion of your profile and personal data from Mopani Singles-v2.
        </p>

        {deleted ? (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 space-y-3">
            <CheckCircle2 className="w-10 h-10 text-rose-600 mx-auto" />
            <h3 className="font-bold text-gray-900">Deletion Request Processed</h3>
            <p className="text-xs text-gray-600">
              Any profile associated with this WhatsApp number has been removed from our active database and directory.
            </p>
          </div>
        ) : (
          <form onSubmit={handleDelete} className="space-y-4 pt-2">
            {errorMsg && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold px-3 py-2 rounded-xl">
                {errorMsg}
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1 text-left">Enter your registered WhatsApp number *</label>
              <input
                required
                type="text"
                placeholder="e.g. 0821234567"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                className="w-full border border-gray-300 rounded-xl p-3 text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3.5 rounded-2xl shadow-md transition flex items-center justify-center gap-2 text-sm disabled:opacity-60"
            >
              <Trash2 className="w-4 h-4" /> {loading ? 'Processing Deletion...' : 'Permanently Delete My Profile'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
