import { useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface TerminalPanelProps {
  title: string
  children: React.ReactNode
}

/**
 * The end of a flow: link invalid, or instructions sent.
 *
 * Focus moves to the heading rather than relying on a live region. A region
 * that mounts with its content already in it is the case screen readers
 * announce least reliably — it was not in the accessibility tree before the
 * text appeared, so there is no change to observe. Moving focus is
 * unambiguous, and it also puts a keyboard user at the start of the new
 * content instead of wherever the form used to be.
 */
export function TerminalPanel({ title, children }: TerminalPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <Card>
      <CardHeader>
        {/* tabIndex -1: focusable programmatically, never a tab stop. */}
        <CardTitle ref={headingRef} tabIndex={-1} className="outline-none">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}
