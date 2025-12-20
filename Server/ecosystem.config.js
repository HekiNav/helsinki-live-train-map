module.exports = {
  apps : [{
    name   : "hki-ltm-api",
    script : "./index.js",
    watch: ["./"],
    ignore_watch: ["comp_cache.db"],
    cron_restart: "0 * * * *"
  }]
}
