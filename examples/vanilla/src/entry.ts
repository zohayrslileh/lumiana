import sharp from 'sharp';

const image = await sharp({
  create: {
    width: 300,
    height: 180,
    channels: 4,
    background: '#22c7b8',
  },
})
  .png()
  .toBuffer();

const url = URL.createObjectURL(
  new Blob([new Uint8Array(image)], {
    type: 'image/png',
  }),
);

const element = document.createElement('img');

element.src = url;
element.alt = 'Generated with Sharp';
element.onload = () => URL.revokeObjectURL(url);

document.body.appendChild(element);
