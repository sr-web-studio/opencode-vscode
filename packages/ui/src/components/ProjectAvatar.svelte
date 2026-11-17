<script lang="ts">
  import { avatarColor, avatarLetter } from "@occ/core/session-tabs"

  /**
   * A project's avatar: its first letter on a colour of its own. The colour comes from the folder path, so a project
   * looks the same in every tab, in the dropdown, in every window and on the phone.
   */
  let { name, directory }: { name: string; directory: string } = $props()
  const letter = $derived(avatarLetter(name))
  const hue = $derived(avatarColor(directory) * 45 + 10)
</script>

<span class="avatar" style:--oc-avatar-hue={hue} aria-hidden="true">{letter}</span>

<style>
  /* Fixed lightness with white text reads in light, dark and high-contrast themes alike. */
  .avatar {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.35em;
    height: 1.35em;
    border-radius: 4px;
    background: hsl(var(--oc-avatar-hue) 45% 40%);
    color: #fff;
    font-size: 0.85em;
    font-weight: 600;
    line-height: 1;
  }
</style>
