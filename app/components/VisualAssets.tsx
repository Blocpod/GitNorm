import Image from "next/image";

const PROJECT_ICONS = {
  orbit: "/icons/project-orbit.png",
  sprout: "/icons/project-sprout.png",
  prism: "/icons/project-prism.png",
  wave: "/icons/project-wave.png",
} as const;

const LEGACY_PROJECT_ICONS: Record<string, keyof typeof PROJECT_ICONS> = {
  "✦": "orbit",
  "◒": "wave",
  "⌁": "wave",
  "✿": "sprout",
  "◆": "prism",
};

export const projectIconNames = Object.keys(PROJECT_ICONS) as Array<
  keyof typeof PROJECT_ICONS
>;

export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <Image
      className={className}
      src="/brand/gitnorm-mark.png"
      alt=""
      aria-hidden="true"
      width={512}
      height={512}
    />
  );
}

export function ProjectIcon({
  icon,
  className = "",
  alt = "",
}: {
  icon?: string;
  className?: string;
  alt?: string;
}) {
  const requested = icon || "orbit";
  const key =
    requested in PROJECT_ICONS
      ? (requested as keyof typeof PROJECT_ICONS)
      : LEGACY_PROJECT_ICONS[requested] || "orbit";
  return (
    <Image
      className={className}
      src={PROJECT_ICONS[key]}
      alt={alt}
      aria-hidden={alt ? undefined : "true"}
      width={320}
      height={320}
    />
  );
}

const WORKFLOW_ART = {
  drop: "/illustrations/drop-it-in.png",
  keep: "/illustrations/keep-making.png",
  show: "/illustrations/show-it-off.png",
} as const;

export function WorkflowArt({
  step,
  className = "",
}: {
  step: keyof typeof WORKFLOW_ART;
  className?: string;
}) {
  return (
    <Image
      className={className}
      src={WORKFLOW_ART[step]}
      alt=""
      aria-hidden="true"
      width={640}
      height={640}
    />
  );
}
