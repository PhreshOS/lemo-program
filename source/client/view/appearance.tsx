import type { CSSProperties, ReactNode } from "react"
import { desktop, system } from "@phreshos/client"
import { DesktopProvider, SystemProvider, useDesktopPreferences, useSystemAppearance } from "@phreshos/react"
import { DocumentTheme, UIProvider, useThemedValue } from "@phreshos/react-ui"

/** The System owns Appearance; this View only follows and composes it. */
export default function Appearance({ children }: Readonly<{ children: ReactNode }>) {
    const pending = <div className="startup-state" role="status">Loading Appearance…</div>
    return <SystemProvider system={system} fallback={pending}>
        <DesktopProvider desktop={desktop} fallback={pending}>
            <ResolvedAppearance>{children}</ResolvedAppearance>
        </DesktopProvider>
    </SystemProvider>
}

function ResolvedAppearance({ children }: Readonly<{ children: ReactNode }>) {
    const appearance = useSystemAppearance()
    const preferences = useDesktopPreferences()
    return <UIProvider appearance={appearance} preferences={preferences}>
        <DocumentTheme />
        <DocumentAppearance>{children}</DocumentAppearance>
    </UIProvider>
}

function DocumentAppearance({ children }: Readonly<{ children: ReactNode }>) {
    const appearance = useSystemAppearance()
    const colors = useThemedValue(appearance.colors)
    const foreground = colors.foreground
    const primary = colors.primary
    const success = colors.success
    const warning = colors.warning
    const danger = colors.danger
    const spacing = appearance.spacing

    return <div className="lemo" style={{
        color: foreground,
        "--spacing": `${spacing}px`,
        "--foreground": foreground,
        "--primary": primary,
        "--success": success,
        "--warning": warning,
        "--danger": danger
    } as CSSProperties}>{children}</div>
}
