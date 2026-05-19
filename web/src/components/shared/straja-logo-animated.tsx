export function StrajaLogoAnimated({
  animate = false,
  className = "h-10 w-10",
}: {
  animate?: boolean
  className?: string
}) {
  // Wider viewBox (-10 padding on each side) so circles don't clip when animating
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-10 -10 60 60"
      fill="none"
      className={className}
      style={{ overflow: "visible" }}
    >
      <circle
        cx="12"
        cy="20"
        r="5.6"
        fill="#059669"
        style={animate ? { transformOrigin: "12px 20px" } : undefined}
        className={animate ? "animate-[logo-face-green_7s_ease-in-out_infinite]" : ""}
      />
      <circle
        cx="25"
        cy="13"
        r="5.6"
        fill="#F97316"
        style={animate ? { transformOrigin: "25px 13px" } : undefined}
        className={
          animate ? "animate-[logo-face-a_7s_ease-in-out_infinite]" : ""
        }
      />
      <circle
        cx="25"
        cy="27"
        r="5.6"
        fill="#F97316"
        style={animate ? { transformOrigin: "25px 27px" } : undefined}
        className={
          animate ? "animate-[logo-face-b_7s_ease-in-out_infinite]" : ""
        }
      />
    </svg>
  )
}
