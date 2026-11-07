process.env.GCLOUD_PROJECT ??= "demo-orma";
import("../functions/src/platform/seed").then(({ seedDemo }) => seedDemo(true, process.argv.find(value => value.startsWith("--date="))?.slice(7)))
  .catch(error => { console.error(error); process.exitCode = 1; });
