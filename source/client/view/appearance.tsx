import { useEffect, type CSSProperties, type ReactNode } from "react"
import { desktop, system } from "@phreshos/client"
import { DesktopProvider, SystemProvider, useDesktopPreferences, useSystemAppearance } from "@phreshos/react"
import { AppearanceProvider, useResolveTheme } from "@phreshos/react-ui"

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
    const { theme } = useDesktopPreferences()
    return <AppearanceProvider appearance={appearance} theme={theme}>
        <DocumentAppearance>{children}</DocumentAppearance>
    </AppearanceProvider>
}

function DocumentAppearance({ children }: Readonly<{ children: ReactNode }>) {
    const appearance = useSystemAppearance()
    const { theme } = useDesktopPreferences()
    const foreground = useResolveTheme(appearance.colors.foreground)
    const primary = useResolveTheme(appearance.colors.primary)
    const success = useResolveTheme(appearance.colors.success)
    const warning = useResolveTheme(appearance.colors.warning)
    const danger = useResolveTheme(appearance.colors.danger)
    const spacing = useResolveTheme(appearance.spacing)

    useEffect(() => {
        const previous = document.documentElement.style.colorScheme
        document.documentElement.style.colorScheme = theme
        return () => { document.documentElement.style.colorScheme = previous }
    }, [theme])

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
