[![npm](https://img.shields.io/npm/v/eleko.svg?maxAge=3600&style=flat-square)](https://www.npmjs.com/package/eleko)
[![npm](https://img.shields.io/npm/l/eleko.svg?maxAge=3600&style=flat-square)](https://github.com/talmobi/eleko/blob/master/LICENSE)
![mac](https://github.com/talmobi/eleko/workflows/mac/badge.svg)
![ubuntu](https://github.com/talmobi/eleko/workflows/ubuntu/badge.svg)
![windows](https://github.com/talmobi/eleko/workflows/windows/badge.svg)

#  eleko
a few electron helper functions (mimics puppeteer API) usable inside electron context + node context launch function that spawns an electron child process with an easy to use subset of the same helper functions (mimics puppeteer API)

## Easy to use
```javascript
  const eleko = require( 'eleko' )

  ;( async function () {
    const browser = await eleko.launch()
    const page = await browser.newPage( { show: true } )

    page.on( 'request', function ( req ) {
      const url = req.url
      const resourceType = req.resourceType

      const shouldBlock = (
        resourceType === 'image' ||
        containsAds( url )
      )

      if ( shouldBlock ) {
        console.log( '(x) blocked url: ' + url.slice( 0, 45 ) )
        return req.abort()
      }

      req.continue()
    } )

    await page.goto( 'https://www.youtube.com/watch?v=WY6sR6HQuMw' )
    await page.waitFor( function () {
      const video = document.querySelector( 'video' )

      if ( video ) {
        video.pause()
        if ( !video._play ) {
          // hide play function from YouTube's internal scripts
          // so that it doesn't autoplay
          video._play = video.play
          video.play = function () {}
        }

        if ( video.readyState === 4 ) { // HAVE_ENOUGH_DATA
          video._play()
          return true
        }
      }

      return false // not ready yet
    } )
  } )()

  const adBlockClient = require( 'ad-block-js' ).create()
  require( 'fs' ).readFileSync(
    require( 'path' ).join( __dirname, '../easylist.txt' ), 'utf8'
  )
  .split( /\r?\n/ )
  .forEach( function ( rule ) {
    adBlockClient.add( rule )
  } )

  function containsAds ( url ) {
    return adBlockClient.matches( url )
  }
```

#### Electron usage ( helper functions )
<details>
  <summary>CLICK ME</summary>

  ```javascript
    // this file is run with the electron binary
    const electron = require( 'electron' )
    const eleko = require( 'eleko' )

    // Module to control application life
    const app = electron.app
    // Module to create native browser window
    const BrowserWindow = electron.BrowserWindow

    app.on( 'ready', main )

    let page
    async function main () {
      page = await eleko.newPage()

      // page.win is an instance of BrowserWindow that is updated
      // every time page.goto is called.

      // block ads using a subset of easylist
      eleko.onrequest( page.win, function ( req ) {
          const url = req.url
          const shouldBlock = containsAds( url )
          if ( shouldBlock ) {
            console.log( '(x) blocked url: ' + url.slice( 0, 45 ) )
            return req.abort()
          }
          return req.continue()
      } )

      const url = 'https://www.youtube.com/watch?v=Gu2pVPWGYMQ'
      await page.goto( url )

      // waitFor string
      await eleko.waitFor( page.win, 'video' )

      // evaluate
      await eleko.evaluate( page.win, function () {
        const video = document.querySelector( 'video' )

        video.pause()

        video._play = video.play // keep reference to original
        video.play = function () {} // remove .play so that YouTube's scripts can't play it automatically
      } )

      // get title
      const title = await eleko.evaluate( page.win, function () {
        return document.title
      } )
      console.log( 'title: ' + title )

      // waitFor function
      await eleko.waitFor( page.win, function () {
        const el = document.querySelector( 'video' )
        // wait until we can play video
        return el && el.readyState === 4 // HAVE_ENOUGH_DATA
      } )

      // evaluate with args ( play video )
      await eleko.evaluate( page.win, function ( selector, data ) {
        const el = document.querySelector( selector )

        // call the original play function
        el[ data.function_name ]()
      }, 'video', { function_name: '_play' } )

      // print video duration periodically
      tick()
      async function tick () {
        const time = await eleko.evaluate( page.win, function () {
          const video = document.querySelector( 'video' )
          return {
            currentTime: video.currentTime,
            duration: video.duration
          }
        } )

        if ( time ) {
          console.log( `${ time.currentTime } / ${ time.duration }` )
        }

        setTimeout( tick, 1000 )
      }
    }

    function containsAds ( url ) {
      return adBlockClient.matches( url )
    }

    const fs = require( 'fs' )
    const path = require( 'path' )
    const adBlockClient = require( 'ad-block-js' ).create()
    fs.readFileSync(
      path.join( __dirname, '../easylist.txt' ), 'utf8'
    )
    .split( /\r?\n/ )
    .forEach( function ( rule ) {
      adBlockClient.add( rule )
    } )
  ```
</details>


#### Node usage ( using launch api )
<details>
  <summary>CLICK ME</summary>

  ```javascript
    const electron = require( 'electron' )
    const eleko = require( 'eleko' )

    const fs = require( 'fs' )
    const path = require( 'path' )

    main()

    async function main ()
    {
      // make sure you have electron installed
      // npm install --save electron ( tested on 7.1.11 )
      const browser = await eleko.launch()
      const page = await browser.newPage()

      const userAgent = await page.call( 'webContents.session.getUserAgent' )
      console.log( 'userAgent: ' + userAgent )

      // cancel or do something before requests
      page.on( 'request', function ( req ) {
        const url = req.url
        const resourceType = req.resourceType

        const shouldBlock = (
          resourceType === 'image' ||
          containsAds( url )
        )

        console.log( 'url: ' + url )
        console.log( 'contains ads: ' + containsAds( url ) )

        if ( shouldBlock ) return req.abort()
        req.continue()
      } )

      console.log( ' == GIRAFFE == ' )

      const url = 'https://www.youtube.com/watch?v=Gu2pVPWGYMQ'
      await page.goto( url )

      console.log( ' == PAGE LOADED == ' )

      const now = Date.now()
      await page.waitFor( 'video' )

      await page.waitFor( function () {
        return document.title.toLowerCase() !== 'youtube'
      } )

      const title = await page.evaluate(
        function ( selector ) {
          return document[ selector ]
        },
        'title'
      )

      console.log( 'title: ' + title )
      console.log( 'waited for: ' + ( Date.now() - now ) )

      await page.waitFor(
        function () {
          const v = document.querySelector( 'video' )
          if ( v ) {
            v.pause()

            // hide play fn so that YouTube's own scripts won't
            // auto play the video
            if ( !v._play ) {
              v._play = v.play
              v.play = function () {}
            }
          }
          // wait until page can be played
          return v && v.readyState === 4 // HAVE_ENOUGH_DATA
        }
      )

      await page.evaluate(
        function () {
          const v = document.querySelector( 'video' )
          v._play()
        }
      )

      // print video duration periodically
      tick()
      async function tick () {
        const time = await page.evaluate( function () {
          const video = document.querySelector( 'video' )
          return {
            currentTime: video.currentTime,
            duration: video.duration
          }
        } )

        if ( time ) {
          console.log( `${ time.currentTime } / ${ time.duration }` )
        }

        setTimeout( tick, 1000 )
      }
    }

    const adBlockClient = require( 'ad-block-js' ).create()
    fs.readFileSync(
      path.join( __dirname, '../easylist.txt' ), 'utf8'
    )
    .split( /\r?\n/ )
    .forEach( function ( rule ) {
      adBlockClient.add( rule )
    } )

    function containsAds ( url ) {
      console.log( 'calling containsAds: ' + url.slice( 0, 55 ) )
      return adBlockClient.matches( url )
    }
  ```
</details>

## About

Simple easy to use api for basic controlling of electron
browser.

## Why

Electron comes bundled with a nice Chromium version that is
capable to play many media formats that default Chromium is
unable to that e.g. Puppeteer comes with. But the API for
puppeteer is much nicer.

## For who?

Those wanting to easy api for basic control of the electron browser. Not intended for scraping.

## How

Within electron a set of helper functions to control a BrowserWindow object.

From node using the launch api setup an IPC for a basic api.

## Similar

[puppeteer](https://github.com/puppeteer/puppeteer)

[puppeteer-electron](https://www.npmjs.com/package/puppeteer-electron)

## Test

#### test node context launch api against a local server
```
npm run test:node
```

#### test electron context helper functions against a local server
```
npm run test:electron
```

#### play youtube video test while blocking ads ( requries internet access )
```
npm run test:youtube
```

#### play youtube h264 video ( default chromium can't play these )
```
npm run test:h264
```

#### play youtube av1 video ( some wooly all-codecs chromium builds can't play these )
```
npm run test:av1
```

#### run all tests
```
npm test
```
