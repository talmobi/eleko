const electron = require( 'electron' )

const fs = require( 'fs' )
const path = require( 'path' )
const url = require( 'url' )

const nfzf = require( 'node-fzf' )

const {
  launch,
  goto,
  waitFor,
  evaluate,
  onBeforeRequest,
  getDefaultOptions,
  containsAds,
} = require( './index.js' )

process.on( 'uncaughtException', function ( error ) {
  console.log( ' === uncaughtException === ' )

  try {
    app.quit()
    console.log( 'exited electron app' )
  } catch ( err ) {
    /* ignore */
  }

  console.log( error )

  process.exit( 1 )
} )

// Module to control application life
const app = electron.app

// Module to create native browser window
const BrowserWindow = electron.BrowserWindow

// Keep a global ref of the window object, if you don't, the widow
// will be closed automatically when the JavaScript object
// is garbage collected
let mainWindow

// example data
const _philipGlassHoursVideoId = 'Wkof3nPK--Y'
const pkmnBlueWaveId = 'pFbkURxNKPE' // requires h264
const creedenceId = 'Gu2pVPWGYMQ' // AV1
const _urlTemplate = 'https://www.youtube.com/watch/$videoId'
const _videoId = creedenceId

async function createWindow ()
{
  // Create the browser window
  mainWindow = new BrowserWindow( {
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      autoplayPolicy: [ 'no-user-gesture-required', 'user-gesture-required', 'document-user-activation-required' ][ 2 ],

      // javascript: false,
      images: false,
      webgl: false,

      nodeIntegration: false,
      webviewTag: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join( __dirname, 'preload.js' )
    }
  } )

  const session = mainWindow.webContents.session

  // set user-agent lowest compatible
  session.setUserAgent( 'Mozilla/5.0 (https://github.com/talmobi/eleko)' )

  // const cookies = electron.session.defaultSession.cookies
  const cookies = session.cookies

  // https://electronjs.org/docs/api/cookies
  // Query all cookies.
  cookies.get( {}, function ( error, cookies ) {
    // console.log( error, cookies )
  } )

  // Query all cookies associated with a specific url.
  cookies.get( { url: 'http://youtube.com' }, function ( error, cookies ) {
    // console.log( error, cookies )
  } )

  // Set a cookie with the given cookie data;
  // may overwrite equivalent cookies if they exist.
  const cookie = { url: 'https://www.youtube.com', name: 'CONSENT', value: 'YES+', domain: '.youtube.com' }
  cookies.set( cookie, function ( error ) {
    if ( error ) console.error( error )
  } )

  // cancel or do something before requests
  session.webRequest.onBeforeRequest(
    function ( details, callback ) {
      let url = details.url

      const shouldBlock = (
        containsAds( url )
      )

      if ( shouldBlock ) {
        console.log( ' (x) ad blocked: ' + url.slice( 0, 23 ) )
        callback( { cancel: true } ) // block
      } else {
        callback( { cancel: false } ) // let through
      }
    }
  )

  mainWindow.on( 'ready-to-show', function () {
    console.log( 'ready-to-show' )
    // mainWindow.show()
  } )

  // and load the index.html of the app
  // mainWindow.loadFile(
  // path.join( __dirname, 'index.html' )
  // )

  // await new Promise( r => setTimeout( r, 5000 ) )

  // example load url
  console.log( 'playing video id: ' + _videoId )
  await goto( mainWindow, _urlTemplate.replace( '$videoId', _videoId ) )

  await waitFor( mainWindow, 'video' )

  let duration = await evaluate( mainWindow, function () {
    const video = document.querySelector( 'video' )
    video.pause()
    video._play = video.play
    video.play = function () {}
    return video.duration
  } )

  console.log( 'video duration: ' + duration )

  let title = await evaluate( mainWindow, function ( el ) {
    return document[ el ]
  }, 'title' )

  console.log( 'title: ' + title )

  console.log( 'waiting for #primary' )
  await waitFor( mainWindow, '#primary' )
  console.log( ' -> #primary found' )

  // sleep and then play another video
  await new Promise( r => setTimeout( r, 1000 * 5 ) )

  await evaluate( mainWindow, function () {
    const el = document.getElementById( 'primary' )
    el.style.background = 'red'

    const video = document.querySelector( 'video' )
    video._play()
  } )

  // sleep and then play another video
  await new Promise( r => setTimeout( r, 1000 * 10 ) )

  await goto( mainWindow, _urlTemplate.replace( '$videoId', _philipGlassHoursVideoId ) )

  await waitFor( mainWindow, 'video' )

  duration = await evaluate( mainWindow, function () {
    const video = document.querySelector( 'video' )
    video.pause()
    video._play = video.play
    video.play = function () {}
    return video.duration
  } )

  console.log( 'video duration: ' + duration )

  title = await evaluate( mainWindow, function ( number, object ) {
    console.log( 'number: ' + number )
    return document[ object.name ]
  }, 888, { name: 'title' } )

  // sleep and then play another video
  await new Promise( r => setTimeout( r, 1000 * 3 ) )

  console.log( 'waiting for #primary' )
  await waitFor( mainWindow, '#primary' )
  console.log( ' -> #primary found' )

  await evaluate( mainWindow, function () {
    const el = document.getElementById( 'primary' )
    el.style.background = 'green'

    const video = document.querySelector( 'video' )
    video._play()
  } )

  // Open the DevTools
  // mainWindow.webContents.openDevTools()

  // Emitted when the window is closed
  mainWindow.on( 'closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element
    mainWindow = null
  } )
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs
app.on( 'ready', async function () {
  createWindow()
} )

// Quit when all windows are closed.
app.on( 'window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  // if ( process.platform !== 'darwin' ) {
  //    app.quit()
  // }

  app.quit()
})

app.on( 'activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if ( mainWindow === null ) {
    createWindow()
  }
})
