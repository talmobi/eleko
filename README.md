[![npm](https://img.shields.io/npm/v/elekid.svg?maxAge=3600&style=flat-square)](https://www.npmjs.com/package/elekid)
[![npm](https://img.shields.io/npm/l/elekid.svg?maxAge=3600&style=flat-square)](https://github.com/talmobi/elekid/blob/master/LICENSE)

#  elekid
tiny collection of electron helper functions (similar to
puppeteer API) + an electron quickstart CLI generator

## Easy to use

#### CLI usage
```javascript
elekid # opens interactive menu
```

#### Module usage
```javascript
// this file is run with the electron binary
const electron = require( 'electron' )
const elekid = require( 'elekid' )

const app = electron.app

let mainWindow
;(async function () {
  // launch BrowserWindow with elekid.getDefaultOptions()
  mainWindow = await elekid.launch( electron )

  // block ads using a subset of easylist
  elekid.onBeforeRequest( mainWindow, function ( details ) {
      const shouldBlock = elekid.containsAds( details.url )
      return shouldBlock
  } )

  const url = 'https://www.youtube.com/watch?v=Gu2pVPWGYMQ'
  await elekid.goto( mainWindow, url )

  // waitFor string
  await elekid.waitFor( mainWindow, 'video' )

  // evaluate
  await elekid.evaluate( mainWindow, function () {
    const video = document.querySelector( 'video' )

    video.pause()

    video._play = video.play // keep reference to original
    video.play = function () {} // remove .play so that YouTube's scripts can't play it automatically
  } )

  // get title
  const title = await elekid.evaluate( mainWindow, function () {
    return document.title
  } )
  console.log( 'title: ' + title )

  // evaluate with args ( play video )
  await elekid.evaluate( mainWindow, function ( selector, data ) {
    const el = document.querySelector( selector )

    // call the original play function
    el[ data.function_name ]()
  }, 'video', { function_name: '_play' } )

  // print video duration periodically
  tick()
  async function tick () {
    const time = await elekid.evaluate( mainWindow, function () {
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

