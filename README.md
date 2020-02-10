[![npm](https://img.shields.io/npm/v/eleko.svg?maxAge=3600&style=flat-square)](https://www.npmjs.com/package/eleko)
[![npm](https://img.shields.io/npm/l/eleko.svg?maxAge=3600&style=flat-square)](https://github.com/talmobi/eleko/blob/master/LICENSE)

#  eleko
tiny collection of electron helper functions (similar to
puppeteer API) + an electron quickstart CLI generator

## Easy to use

#### CLI usage
```javascript
eleko # opens interactive menu
```

#### Module usage
```javascript
// this file is run with the electron binary
const electron = require( 'electron' )
const eleko = require( 'eleko' )

const app = electron.app

let mainWindow
;(async function () {
  // launch BrowserWindow with eleko.getDefaultOptions()
  mainWindow = await eleko.launch( electron )

  // block ads using a subset of easylist
  eleko.onBeforeRequest( mainWindow, function ( details ) {
      const shouldBlock = eleko.containsAds( details.url )
      return shouldBlock
  } )

  const url = 'https://www.youtube.com/watch?v=Gu2pVPWGYMQ'
  await eleko.goto( mainWindow, url )

  // waitFor string
  await eleko.waitFor( mainWindow, 'video' )

  // evaluate
  await eleko.evaluate( mainWindow, function () {
    const video = document.querySelector( 'video' )

    video.pause()

    video._play = video.play // keep reference to original
    video.play = function () {} // remove .play so that YouTube's scripts can't play it automatically
  } )

  // get title
  const title = await eleko.evaluate( mainWindow, function () {
    return document.title
  } )
  console.log( 'title: ' + title )

  // evaluate with args ( play video )
  await eleko.evaluate( mainWindow, function ( selector, data ) {
    const el = document.querySelector( selector )

    // call the original play function
    el[ data.function_name ]()
  }, 'video', { function_name: '_play' } )

  // print video duration periodically
  tick()
  async function tick () {
    const time = await eleko.evaluate( mainWindow, function () {
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
} )()
```

## About

## Why

## For who?

## How

## Alternatives

## Test
```
npm test
```
