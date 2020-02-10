const electron = require( 'electron' )
const eleko = require( '../index.js' )

const nfzf = require( 'node-fzf' )
const redstar = require( 'redstar' )

const fs = require( 'fs' )
const path = require( 'path' )

main()

async function main ()
{
  const api = await eleko.launch()
  const userAgent = await api.call( 'webContents.session.getUserAgent' )
  console.log( userAgent )

  // cancel or do something before requests
  await api.onBeforeRequest( function ( details ) {
    const url = details.url

    const shouldBlock = (
      eleko.containsAds( url )
    )

    return shouldBlock
  } )

  const url = 'https://www.youtube.com/watch?v=Gu2pVPWGYMQ'
  await api.call( 'loadURL', url )

  console.log( ' == PAGE LOADED == ' )

  const title = await api.evaluate(
    function ( selector ) {
      return document[ selector ]
    },
    'title'
  )

  console.log( 'title: ' + title )
  console.log( 'title: ' + title )
  console.log( 'title: ' + title )
  console.log( 'title: ' + title )
  console.log( 'title: ' + title )

  const now = Date.now()
  await api.waitFor( 'video' )
  console.log( 'waited for: ' + ( Date.now() - now ) )

  await api.evaluate(
    function () {
      const v = document.querySelector( 'video' )
      v.pause()
      v._play = v.play
      v.play = function () {}
    }
  )

  console.log( 'waiting 5 seconds' )
  await new Promise( r => setTimeout( r, 1000 * 5 ) )
  console.log( 'waiting done, playing...' )

  await api.evaluate(
    function () {
      const v = document.querySelector( 'video' )
      v._play()
    }
  )
}

