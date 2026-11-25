# Changelog

## 0.1.0

1. **First release of `@egaki/midjourney`** — a Midjourney SDK that drives midjourney.com through your signed-in Chrome with the Playwriter extension. No API key. It generates images and videos, uploads reference images, upscales, pans and searches the explore feed:

   ```ts
   import { Midjourney, getImageUrl } from '@egaki/midjourney'

   const mj = new Midjourney()
   const job = await mj.generate('a lighthouse in a storm', { aspectRatio: '16:9' })
   await mj.waitForJob(job.job_id)
   const image = await mj.downloadImage(getImageUrl(job.job_id, 0))
   ```

2. **`upscaleImage()` upscales any image 2x**, not only Midjourney generations. It registers the image as an editor upload, runs the subtle or creative upscaler and downloads the result. `egaki upscale -m midjourney` uses it:

   ```ts
   const result = await mj.upscaleImage(fs.readFileSync('photo.jpg'), { type: 'v7_2x_subtle' })
   fs.writeFileSync('photo-2x.jpg', result.image)
   ```
