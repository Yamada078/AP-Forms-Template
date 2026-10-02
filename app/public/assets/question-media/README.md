**English** · [ภาษาไทย](README.th.md)

# Question images

Question Studio reads the image list from `manifest.json` in this directory. PNG, JPG, JPEG, WebP and GIF are supported.

## Add images

1. Add the files to `public/assets/question-media/`.
2. From the application directory containing `wrangler.jsonc`, run:

```sh
node scripts/generate-question-media-manifest.mjs
```

3. Deploy the images, `manifest.json` and `versioned/` directory with the website.
4. Open Question Studio to select an image.

The script creates copies in `versioned/` using content hashes in their filenames and updates the manifest automatically.

## Images in published versions

Published question packs reference images in `versioned/` so those versions retain the original images. To update an image, replace its source file and run the script again. Keep older versioned copies still referenced by published packs, and do not edit an existing hashed file in place.

These images are accessible from the website. Use only images intended to be published.

[Form media](../README.md)
