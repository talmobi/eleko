const eleko = require( './index.js' )

main()

async function main () {
  try {
    const browser = await eleko.launch()
    const page = await browser.newPage()

    tick()
    async function tick () {
      console.log( ' == tick == ' )

      try {
        const v =  await page.evaluate( function () {
          console.log( ' === page:evaluate tick === ' )
          return document.title
        } )

        console.log( 'tick value: ' + v )
      } catch ( err ) {
        console.log( 'tick error: ' + err )
      }

      setTimeout( tick, 1000 )
    }

    console.log( page )

    await page.goto( 'https://youtube.com' )

    await page.waitFor( 1000 * 10 )

    page.onrequest = function ( req ) {
      const url = req.url
      // console.log( 'url: ' + url.slice( 0, 55 ) + '...' )

      if ( url.indexOf( 'font' ) >= 0 ) return req.abort()
      req.continue()
    }

    await page.goto( 'about:blank' )

    await page.goto( 'https://google.com' )

    await page.goto( 'https://reddit.com' )

    const title = await page.evaluate( function ( el ) {
      return document[ el ]
    }, 'title' )

    console.log( 'page title: ' + title )

    await page.evaluate( function ( title ) {
      console.log( ' PAGE TITLE: ' + title )
    }, title )

    // await page.close()
  } catch ( err ) {
    console.log( 'whale' )
    console.log( err )
    process.exit( 1 )
  }
}
