<script lang="ts">
  export let src = "a.png";
</script>

<!-- strip -->
<p>
  Removed before compiling, so the lines below move up.
</p>
<!-- /strip -->
<img {src} />

<style lang="custom">
  #!custom
  img {
    color: red;
  }
</style>
