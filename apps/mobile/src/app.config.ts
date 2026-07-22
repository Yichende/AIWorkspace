export default defineAppConfig({
  pages: [
    'pages/login/index',
    'pages/home/index',
    'pages/chat/index',
    'pages/search/index',
    'pages/myTest/index',
    'pages/addModel/index',
  ],
  window: {
    navigationBarTitleText:"AI WorkSpace",

    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTextStyle: 'black'
  }
})
