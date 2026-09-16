import type { AppUser } from '../types'
import { AppIcon, APP_NAME, UabLogo } from './Brand'
import { OfflineBanner } from './OfflineBanner'
import { roleLabel } from './text'
import { UserMenu } from './UserMenu'

export function Header({ user, online }: { user: AppUser; online: boolean }) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand">
          <AppIcon size={32} />
          <p className="brand-title">{APP_NAME}</p>
        </div>
        <UabLogo />
        <p className="header-user">
          <strong>{user.name}</strong>
          <span aria-hidden="true" className="header-user-sep">
            {' · '}
          </span>
          <span>{roleLabel(user.role)}</span>
        </p>
        <div className="header-menu">
          <UserMenu user={user} online={online} />
        </div>
      </div>
      <OfflineBanner online={online} />
    </header>
  )
}
