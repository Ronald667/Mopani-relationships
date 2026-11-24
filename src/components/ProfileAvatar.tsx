interface ProfileAvatarProps {
  src?: string | null
  name?: string | null
  className?: string
  textSizeClass?: string
}

export function ProfileAvatar({
  src,
  name,
  className = 'w-12 h-12 rounded-full',
  textSizeClass = 'text-sm',
}: ProfileAvatarProps) {
  const initials = (name || 'MS')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'MS'

  if (src && src.trim().length > 0) {
    return (
      <img
        src={src}
        alt={name || 'Profile photo'}
        className={`${className} object-cover`}
      />
    )
  }

  return (
    <div
      aria-label={name || 'Profile avatar'}
      className={`${className} bg-gradient-to-br from-rose-700 via-rose-800 to-amber-700 text-white font-bold flex items-center justify-center select-none ${textSizeClass}`}
    >
      {initials}
    </div>
  )
}
