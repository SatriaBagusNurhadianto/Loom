import logo from '../../../design/brand/loom-logo.svg';

/** Outlined lockup inherits the current text color, including forced colors. */
export function LoomLogo() {
  return (
    <span
      class="loom-logo"
      role="img"
      aria-label="Loom"
      style={{ 'mask-image': `url("${logo}")` }}
    />
  );
}
