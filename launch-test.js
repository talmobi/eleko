const electron = require( 'electron' )
const eleko = require( './index.js' )

const nfzf = require( 'node-fzf' )
const redstar = require( 'redstar' )

const fs = require( 'fs' )
const path = require( 'path' )

main()

async function main ()
{
  const mainWindow = await eleko.launch()
  const userAgent = await mainWindow.call( 'webContents.session.getUserAgent' )
  console.log( userAgent )

  // cancel or do something before requests
  await mainWindow.call(
    'webContents.session.webRequest.onBeforeRequest',
    function ( details, callback ) {
      let url = details.url

      const shouldBlock = (
        eleko.containsAds( url )
      )

      if ( shouldBlock ) {
        console.log( ' (x) ad blocked: ' + url.slice( 0, 23 ) )
        callback( { cancel: true } ) // block
      } else {
        callback( { cancel: false } ) // let through
      }
    }
  )

  const url = 'https://www.youtube.com/watch?v=Gu2pVPWGYMQ'
  await mainWindow.call( 'loadURL', url )

  console.log( ' == PAGE LOADED == ' )

  const title = await mainWindow.call(
    'webContents.executeJavaScript',
    eleko.parseFunction(
      function ( selector ) {
        return document[ selector ]
      },
      [ 'title' ]
    ),
    true
  )

  console.log( 'title: ' + title )
  console.log( 'title: ' + title )
  console.log( 'title: ' + title )
  console.log( 'title: ' + title )
  console.log( 'title: ' + title )

  await mainWindow.call(
    'webContents.executeJavaScript',
    eleko.parseFunction(
      function () {
        const v = document.querySelector( 'video' )
        v.pause()
        v._play = v.play
        v.play = function () {}
      }
    ),
    true
  )

  console.log( 'waiting 5 seconds' )
  await new Promise( r => setTimeout( r, 1000 * 5 ) )
  console.log( 'waiting done, playing...' )

  await mainWindow.call(
    'webContents.executeJavaScript',
    eleko.parseFunction(
      function () {
        const v = document.querySelector( 'video' )
        v._play()
      }
    ),
    true
  )
}
