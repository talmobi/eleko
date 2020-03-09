const eleko = require( './index.js' )
main()

async function main () {
  try {
    const browser = await eleko.launch()
    const page = await browser.newPage()

    // await page.goto( 'https://get.webgl.org' )
    await page.goto( 'chrome://gpu' )
  } catch ( err ) {
    throw err
  }
}
