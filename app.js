$(document).ready(function() {
	$('.menu-toggler').on('click', () => {
		$(this).toggleClass('open');
		$('.top-nav').toggleClass('open');
	});

	$('.top-nav .nav-link').on('click', () => {
		$('.menu-toggler').removeClass('open');
		$('.top-nav').removeClass('open');
	});

	$('nav a[href*="#"]').on('click', () => {
		$('html, body').animate(
			{
				scrollTop: $($(this).attr('href')).offset().top - 100,
			},
			2000,
		);
	});

	$('#up').on('click', () => {
		$('html, body').animate(
			{
				scrollTop: 0,
			},
			2000,
		);
	});

	AOS.init({
		easing: 'ease',
		duration: 1800,
		once: true,
	});
});
